/**
 * dsh-session-shred — host half.
 *
 * Registers one authenticated endpoint on the Connection service's fetch-route
 * registry (`/api/dsh-session-shred/delete`) and implements the physical,
 * non-recoverable deletion of a session: its durable event log and its
 * archive-set membership. The data root has no trash / recycle bin, so removing
 * the files is a real delete.
 *
 * Deleting a LIVE session (one whose agent is loaded) is refused, so the agent
 * driver never writes into a directory that disappeared beneath it.
 *
 * `ctx.connection.fetch.register` is the supported custom-endpoint path — the
 * same one dsh-client-file-upload and dsh-session-log-export use. The generic
 * `connection.rpc.handle` channel is used by no shipped plugin.
 */
import { dirname } from 'node:path';
import { rm } from 'node:fs/promises';

export const inject = ['connection', 'webServer', 'sessionPersistence', 'workspaceRegistry'];

const ROUTE_PATH = '/api/dsh-session-shred/delete';
const DIAG_PREFIX = '/dsh-session-shred';
const CLIENT_MARK_PATH = '/dsh-session-shred/client-loaded';

/** Diagnostics only: last time the browser half announced that it loaded. */
let clientLoadedAt = null;

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let payload;
          try {
            payload = await request.json();
          } catch {
            payload = undefined;
          }
          try {
            return Response.json(await handleDelete(ctx, payload));
          } catch (err) {
            return Response.json(internalError(err));
          }
        },
      }),
    'dsh-session-shred: delete route',
  );

  // Plain loopback diagnostic route (no session cookie needed) so both halves
  // can be verified from a terminal: GET /dsh-session-shred/ping reports host
  // liveness plus whether the browser half has announced itself.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: DIAG_PREFIX,
        handler: (req, res) => {
          let pathname = req.url || '/';
          const q = pathname.indexOf('?');
          if (q !== -1) pathname = pathname.slice(0, q);
          if (pathname === CLIENT_MARK_PATH && req.method === 'POST') {
            clientLoadedAt = Date.now();
          }
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(
            JSON.stringify({
              ok: true,
              plugin: 'dsh-session-shred',
              version: '1.0.0',
              clientLoadedAt,
              hasPersistence: typeof ctx.get('sessionPersistence') === 'object',
              hasWorkspaceRegistry: typeof ctx.get('workspaceRegistry') === 'object',
              at: Date.now(),
            }),
          );
        },
      }),
    'dsh-session-shred: diagnostic route',
  );
}

function internalError(err) {
  const message = err && err.message ? err.message : String(err);
  return { ok: false, error: { code: 'internal', message, details: {} } };
}

function badRequest(message) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } };
}

function notFound(sessionId) {
  return { ok: false, error: { code: 'session-not-found', message: `未找到会话 ${sessionId}`, details: { sessionId } } };
}

function sessionConflict(sessionId, cwd) {
  return {
    ok: false,
    error: {
      code: 'agent-busy',
      message: '该会话正在运行中，请先停止它，再执行永久删除。',
      details: { sessionId, requestedCwd: cwd || '' },
    },
  };
}

/**
 * Resolve one stored session's immutable header. The 0.2.x persistence service
 * exposes `stat(id)` and `list()` returning snapshots shaped
 * `{ header, revision, sizeBytes? }` — never a bare header.
 * @param persistence - the live sessionPersistence service.
 * @param sessionId - the session to resolve.
 * @returns the stored header, or undefined when the session is unknown.
 */
async function resolveHeader(persistence, sessionId) {
  if (typeof persistence.stat === 'function') {
    const snap = await persistence.stat(sessionId);
    if (snap && snap.header) return snap.header;
  }
  const snapshots = await persistence.list();
  const found = snapshots.find((s) => s && s.header && s.header.id === sessionId);
  return found ? found.header : undefined;
}

async function handleDelete(ctx, payload) {
  const sessionId = payload && typeof payload === 'object' ? payload.sessionId : undefined;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return badRequest('sessionId 是必填项');

  const persistence = ctx.sessionPersistence;

  let header;
  try {
    header = await resolveHeader(persistence, sessionId);
  } catch (err) {
    return internalError(err);
  }
  if (!header) return notFound(sessionId);

  // Refuse only when the Session's Agent is RUNNING (actively processing a
  // turn). An idle (already-switched-away) Agent is safe to delete — `ctx.sessions`
  // and even `ctx.agents` both retain switched-away sessions, so their mere
  // presence must not block deletion.
  const agents = ctx.get('agents');
  const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined;
  if (agent && agent.status === 'running') {
    return sessionConflict(sessionId, header.cwd);
  }

  // Drop it from the archive set (no-op when it was never archived).
  try {
    await ctx.workspaceRegistry.unarchiveSession(sessionId);
  } catch {
    /* best effort */
  }

  const removed = [];
  try {
    const loc = typeof persistence.locate === 'function' ? persistence.locate(header) : undefined;
    if (loc && loc.path) {
      // loc.path = <dshHome>/sessions/<projectKey>/session-<id>/<generation log>
      const sessionDir = dirname(loc.path);
      await rm(sessionDir, { recursive: true, force: true });
      removed.push(sessionDir);
    }
  } catch (err) {
    return internalError(err);
  }

  // Drop the row from the client's live session list immediately. This is the
  // same event the session controller relays when a session leaves the store.
  try {
    ctx.emit('api-session/removed', sessionId);
  } catch {
    /* ignore */
  }

  return { ok: true, value: { sessionId, removed } };
}
