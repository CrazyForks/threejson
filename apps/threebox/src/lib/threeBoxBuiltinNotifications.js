/**
 * Device-scoped built-in notifications, ported from
 * tools/scene-host/threebox/js/threeBoxBuiltinNotifications.js (structure follows threebox-cloud's
 * port). A self-contained bell+panel widget mounted directly to document.body with its own polling
 * lifecycle, independent of the React tree. Markdown uses a deliberately small, escaped renderer;
 * malformed input falls back to plain text and never injects raw HTML.
 */
import { THREEBOX_BUILTIN_PROVIDER_TYPE } from "./threeBoxSettingsSchema.js";

const escapeHtml = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[x]
  );

function markdown(value) {
  try {
    return escapeHtml(value)
      .replace(/^### (.*)$/gm, "<h4>$1</h4>")
      .replace(/^## (.*)$/gm, "<h3>$1</h3>")
      .replace(/^# (.*)$/gm, "<h2>$1</h2>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  } catch {
    return escapeHtml(value);
  }
}

export function createThreeBoxBuiltinNotifications(settingsProvider) {
  let interval = null;
  const seen = new Set();
  let list = [];
  let bell = null;
  let panel = null;

  function config() {
    const settings = settingsProvider?.() || {};
    const provider = settings.ai?.providers?.find((entry) => entry.provider === THREEBOX_BUILTIN_PROVIDER_TYPE);
    return {
      enabled: settings.general?.builtinNotificationsEnabled === true,
      base: String(settings.ai?.builtinBackendUrl || "https://api.threebox.org").replace(/\/$/, ""),
      key: provider?.apiKey || ""
    };
  }

  async function markRead(notification) {
    const current = config();
    if (!current.key) {
      return;
    }
    await fetch(`${current.base}/v1/builtin-notifications/${encodeURIComponent(notification.id)}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${current.key}` }
    });
    notification.read = 1;
    render();
  }

  function render() {
    if (!bell || !panel) {
      return;
    }
    const unread = list.filter((item) => !item.read).length;
    bell.innerHTML = `♢${unread ? `<em>${unread}</em>` : ""}`;
    panel.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = "通知";
    panel.append(title);
    if (!list.length) {
      const empty = document.createElement("p");
      empty.textContent = "暂无通知";
      panel.append(empty);
    }
    for (const notification of list) {
      const row = document.createElement("article");
      row.className = `threeboxNoticeItem ${notification.read ? "read" : ""}`;
      row.innerHTML = `<b>${escapeHtml(notification.title)}</b><div class="threeboxNoticeBody">${
        notification.content_format === "markdown" ? markdown(notification.body) : escapeHtml(notification.body)
      }</div><small>${new Date(notification.created_at || Date.now()).toLocaleString()}</small>`;
      row.addEventListener("click", () => void markRead(notification));
      panel.append(row);
    }
  }

  function ensureUi() {
    if (bell) {
      return;
    }
    bell = document.createElement("button");
    bell.type = "button";
    bell.className = "threeboxNotificationBell";
    bell.setAttribute("aria-label", "通知");
    bell.addEventListener("click", () => {
      if (panel) {
        panel.hidden = !panel.hidden;
      }
    });
    panel = document.createElement("section");
    panel.className = "threeboxNotificationInbox";
    panel.hidden = true;
    document.body.append(bell, panel);
    document.addEventListener("pointerdown", (event) => {
      if (panel && !panel.hidden && event.target !== bell && !panel.contains(event.target)) {
        panel.hidden = true;
      }
    });
    render();
  }

  function toast(notification) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "threeboxBuiltinNotice";
    node.innerHTML = `<strong>${escapeHtml(notification.title)}</strong><span>${escapeHtml(notification.body).slice(0, 180)}</span>`;
    node.addEventListener("click", () => {
      if (panel) {
        panel.hidden = false;
      }
      void markRead(notification);
      node.remove();
    });
    document.body.append(node);
    setTimeout(() => node.remove(), 8500);
  }

  async function poll() {
    const current = config();
    if (!current.enabled || !current.key) {
      return;
    }
    const response = await fetch(`${current.base}/v1/builtin-notifications`, {
      headers: { Authorization: `Bearer ${current.key}` }
    });
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    list = body.notifications || [];
    ensureUi();
    render();
    for (const notification of list) {
      if (!notification.read && !seen.has(notification.id)) {
        seen.add(notification.id);
        toast(notification);
      }
    }
  }

  return {
    start() {
      ensureUi();
      if (interval) {
        clearInterval(interval);
      }
      void poll();
      interval = setInterval(() => void poll(), 5 * 60_000);
    },
    refresh: poll,
    stop() {
      if (interval) {
        clearInterval(interval);
      }
      interval = null;
      bell?.remove();
      panel?.remove();
      bell = null;
      panel = null;
    }
  };
}
