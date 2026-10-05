// dsh-session-shred — client half.
//
// Two slot entries:
//  - `sidebar.workspaces.session.menu.item` — the "永久删除" row in a Session's
//    "..." menu. It refuses the currently-open Session (the one retained by the
//    main view) before even asking, and otherwise triggers the confirmation.
//  - `shell.overlay` — a frame-wide floating layer. Here lives the actual
//    confirmation dialog, rendered via `createPortal` to `document.body`, and
//    driven by a tiny module-level store so it survives the menu closing.
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

    const inject = ["slots"];
    const MENU_SLOT = "sidebar.workspaces.session.menu.item";
    const OVERLAY_SLOT = "shell.overlay";
    const ROUTE = "/api/dsh-session-shred/delete";

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

    function closeMenu(menuState) {
      if (Array.isArray(menuState)) {
        if (typeof menuState[1] === "function") { try { menuState[1](false); } catch (_e) {} }
        return;
      }
      if (typeof menuState === "function") { try { menuState(false); } catch (_e) {} return; }
      if (menuState && typeof menuState.close === "function") { try { menuState.close(); } catch (_e) {} return; }
      if (menuState && typeof menuState.setOpen === "function") { try { menuState.setOpen(false); } catch (_e) {} }
    }

    // Menu row: refuse the currently-open session, otherwise trigger confirm.
    function DeleteMenuItem(props) {
      const { sessionId, displayTitle, useMenuOpenState, usePanelInfo, useSessions } = props;
      const menuState = typeof useMenuOpenState === "function" ? useMenuOpenState() : null;

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

      const onClick = () => {
        closeMenu(menuState);
        triggerConfirm({ sessionId, displayTitle, isCurrent });
      };

      return React.createElement(
        "button",
        {
          type: "button",
          role: "menuitem",
          onClick,
          style: {
            display: "block",
            width: "100%",
            textAlign: "left",
            color: "var(--dsw-alias-state-error-primary, #d93026)",
          },
        },
        "永久删除",
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
            React.createElement("div", { style: style.title }, "永久删除会话"),
            React.createElement(
              "div",
              { style: style.body },
              isCurrent
                ? "这是当前正在使用的会话，无法删除。请先切换到其它会话，再执行永久删除。"
                : "确定要永久删除会话「" + name + "」吗？此操作会彻底删除其对话记录，且无法找回。",
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
