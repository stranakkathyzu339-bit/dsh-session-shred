// dsh-session-shred — client half.
//
// Two slot entries:
//  - `sidebar.workspaces.session.menu.item` — the "删除会话" row in a Session's
//    "..." menu, rendered with the shipped `MenuItemButton` (normal tone, trash
//    icon, `Ctrl+Shift+D` shortcut) so it reads as a built-in row.
//  - `shell.overlay` — a frame-wide floating layer where the confirmation
//    dialog lives, rendered via `createPortal` to `document.body` and driven by
//    a tiny module-level store so it survives the menu closing.
//
// No native `confirm`/`alert`: those steal window focus and break typing.
window.__ModuleLoader__.load({
  id: "dsh-session-shred",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const ReactDOM = require("react-dom");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const MenuItemButton = primitives.MenuItemButton;
    const IconTrashOutlineRegular = primitives.IconTrashOutlineRegular;

    const inject = ["slots", "shortcuts", "sessions"];
    const MENU_SLOT = "sidebar.workspaces.session.menu.item";
    const OVERLAY_SLOT = "shell.overlay";
    const ROUTE = "/api/dsh-session-shred/delete";
    const SHORTCUT_ID = "session.delete";

    // ---- tiny shared confirm store -----------------------------------------
    let pending = null;
    let listener = null;
    function triggerConfirm(entry) {
      pending = entry;
      if (listener) listener(pending);
    }
    function clearConfirm() {
      pending = null;
      if (listener) listener(null);
    }
    function usePendingConfirm() {
      const [state, setState] = React.useState(pending);
      React.useEffect(() => {
        listener = setState;
        return () => { if (listener === setState) listener = null; };
      }, []);
      return state;
    }

    const style = {
      overlay: {
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0, 0, 0, 0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 99999,
      },
      dialog: {
        background: "var(--dsw-specific-surface, #ffffff)",
        color: "var(--dsw-alias-label-primary, #1a1a1a)",
        borderRadius: 10, padding: "20px 22px", maxWidth: 420,
        width: "calc(100vw - 48px)",
        boxShadow: "0 12px 48px rgba(0, 0, 0, 0.35)",
      },
      title: { margin: "0 0 10px", fontSize: 16, fontWeight: 600 },
      body: { margin: "0 0 16px", fontSize: 14, lineHeight: 1.6 },
      error: { margin: "0 0 12px", fontSize: 13, color: "var(--dsw-alias-state-error-primary, #d93026)" },
      actions: { display: "flex", gap: 8, justifyContent: "flex-end" },
      cancel: {
        padding: "6px 14px", borderRadius: 6, fontSize: 13, cursor: "pointer",
        border: "1px solid var(--dsw-alias-border, #cccccc)",
        background: "transparent", color: "inherit",
      },
      danger: {
        padding: "6px 14px", borderRadius: 6, fontSize: 13, cursor: "pointer",
        border: "none", background: "var(--dsw-alias-state-error-primary, #d93026)", color: "#ffffff",
      },
    };

    // Menu row: styled exactly like the shipped rename/fork/archive rows.
    function DeleteMenuItem(props) {
      const { sessionId, displayTitle, useMenuOpenState, useShortcuts, usePanelInfo, useSessions } = props;
      const [, setMenuOpen] = typeof useMenuOpenState === "function" ? useMenuOpenState() : [null, () => {}];
      const shortcut = typeof useShortcuts === "function"
        ? useShortcuts((rows) => rows.find((row) => row.id === SHORTCUT_ID))
        : undefined;

      const panelActive = typeof usePanelInfo === "function"
        ? usePanelInfo((info) => info.activePanelId !== null)
        : false;
      const sessionState = typeof useSessions === "function" ? useSessions((state) => state) : null;

      let isCurrent = false;
      if (!panelActive && sessionState && sessionState.byId) {
        const found = Object.values(sessionState.byId).find(
          (s) => s && s.retainedBy && (s.retainedBy.mainView ?? 0) > 0,
        );
        isCurrent = !!found && found.id === sessionId;
      }

      const onSelect = () => {
        setMenuOpen(false);
        triggerConfirm({ sessionId, displayTitle, isCurrent });
      };

      return React.createElement(
        MenuItemButton,
        {
          shortcut: shortcut,
          icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
          onSelect: onSelect,
        },
        "删除会话",
      );
    }

    // Overlay: renders the dialog whenever a confirmation is pending.
    function ConfirmDialog() {
      const pending = usePendingConfirm();
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);

      React.useEffect(() => {
        setBusy(false);
        setMessage(null);
      }, [pending]);

      if (!pending) return null;

      const name = pending.displayTitle && String(pending.displayTitle).trim().length > 0
        ? String(pending.displayTitle)
        : pending.sessionId;

      const isCurrent = !!pending.isCurrent;

      const cancel = () => {
        if (busy) return;
        clearConfirm();
      };

      const confirmDelete = () => {
        setBusy(true);
        setMessage(null);
        fetch(ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: pending.sessionId }),
        })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error("HTTP " + response.status))))
          .then((result) => {
            if (result && result.ok === false) {
              setMessage(result.error && result.error.message ? result.error.message : "未知错误");
              setBusy(false);
            } else {
              clearConfirm();
            }
          })
          .catch((err) => {
            setMessage(err && err.message ? err.message : String(err));
            setBusy(false);
          });
      };

      return ReactDOM.createPortal(
        React.createElement(
          "div",
          { style: style.overlay },
          React.createElement(
            "div",
            { style: style.dialog },
            React.createElement("div", { style: style.title }, "删除会话"),
            React.createElement(
              "div",
              { style: style.body },
              isCurrent
                ? "这是当前正在使用的会话，无法删除。请先切换到其它会话，再执行删除。"
                : "确定要删除会话「" + name + "」吗？此操作会彻底删除其对话记录，且无法找回。",
            ),
            message && React.createElement("div", { style: style.error }, "删除失败：" + message),
            React.createElement(
              "div",
              { style: style.actions },
              React.createElement(
                "button",
                { type: "button", onClick: cancel, disabled: busy, style: style.cancel },
                isCurrent ? "知道了" : "取消",
              ),
              !isCurrent &&
                React.createElement(
                  "button",
                  { type: "button", onClick: confirmDelete, disabled: busy, style: style.danger },
                  busy ? "删除中…" : "删除",
                ),
            ),
          ),
        ),
        document.body,
      );
    }

    function apply(ctx) {
      // Diagnostics: tell the host half that this browser half loaded.
      try {
        fetch("/dsh-session-shred/client-loaded", { method: "POST" }).catch(function () {});
      } catch (_e) {}

      // Register the "删除会话" shortcut (Ctrl+Shift+D), targeting the current
      // Session like the shipped rename/fork/archive shortcuts do.
      ctx.effect(() => ctx.shortcuts.register({
        id: SHORTCUT_ID,
        label: () => "删除会话",
        aliases: ["delete session", "shred session"],
        defaults: {
          "desktop:macos": { code: "KeyD", modifiers: ["primary", "shift"] },
          "desktop:windows": { code: "KeyD", modifiers: ["primary", "shift"] },
          "desktop:linux": { code: "KeyD", modifiers: ["primary", "shift"] },
          "web:macos": { code: "KeyD", modifiers: ["primary", "shift"] },
          "web:windows": { code: "KeyD", modifiers: ["primary", "shift"] },
        },
        regions: ["page", "editable"],
        modals: [],
        resolve: () => {
          let current;
          try {
            const snapshot = ctx.sessions && ctx.sessions.list ? ctx.sessions.list.getSnapshot() : null;
            current = snapshot
              ? Object.values(snapshot.byId).find((row) => row.retainedBy && (row.retainedBy.mainView ?? 0) > 0)
              : undefined;
          } catch (_e) {
            current = undefined;
          }
          if (!current) return { status: "blocked", reason: "没有正在查看的会话" };
          return {
            status: "handled",
            run: () => triggerConfirm({ sessionId: current.id, displayTitle: current.title, isCurrent: true }),
          };
        },
      }), "dsh-session-shred: shortcut");

      ctx.slots.inject(MENU_SLOT, () =>
        ctx.slots.register(
          { name: MENU_SLOT, id: "dsh-session-shred.delete", order: 500 },
          DeleteMenuItem,
        ),
      );
      ctx.slots.inject(OVERLAY_SLOT, () =>
        ctx.slots.register(
          { name: OVERLAY_SLOT, id: "dsh-session-shred.confirm", order: 500 },
          ConfirmDialog,
        ),
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
