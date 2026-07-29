import { t } from "../i18n/index.js";

const STORAGE_PREFIX = "threejson.builtin-provider-privacy.v1";
export const BUILTIN_PRIVACY_ACCEPTED = "accepted";
export const BUILTIN_PRIVACY_DECLINED = "declined";

function storageKey(scope) {
  return `${STORAGE_PREFIX}.${scope === "editor" ? "editor" : "threebox"}`;
}

export function getBuiltinPrivacyDecision(scope) {
  try {
    const value = localStorage.getItem(storageKey(scope));
    return value === BUILTIN_PRIVACY_ACCEPTED || value === BUILTIN_PRIVACY_DECLINED ? value : null;
  } catch {
    return null;
  }
}

export function setBuiltinPrivacyDecision(scope, decision) {
  if (decision !== BUILTIN_PRIVACY_ACCEPTED && decision !== BUILTIN_PRIVACY_DECLINED) {
    throw new Error("Invalid built-in provider privacy decision.");
  }
  try {
    localStorage.setItem(storageKey(scope), decision);
  } catch {
    /* The in-memory UI still updates; a storage-restricted browser will ask again next session. */
  }
  return decision;
}

export function isBuiltinPrivacyAccepted(scope) {
  return getBuiltinPrivacyDecision(scope) === BUILTIN_PRIVACY_ACCEPTED;
}

function appendParagraph(parent, key, fallback, className = "") {
  const p = document.createElement("p");
  if (className) p.className = className;
  p.textContent = t(key, fallback);
  parent.appendChild(p);
}

function appendSection(parent, titleKey, titleFallback, bodyKey, bodyFallback) {
  const section = document.createElement("section");
  section.className = "builtinPrivacySection";
  const title = document.createElement("h3");
  title.textContent = t(titleKey, titleFallback);
  section.appendChild(title);
  appendParagraph(section, bodyKey, bodyFallback);
  parent.appendChild(section);
  return section;
}

function appendList(parent, items) {
  const list = document.createElement("ul");
  list.className = "builtinPrivacyList";
  for (const [key, fallback] of items) {
    const item = document.createElement("li");
    item.textContent = t(key, fallback);
    list.appendChild(item);
  }
  parent.appendChild(list);
}

function buildDialog() {
  const overlay = document.createElement("div");
  overlay.className = "builtinPrivacyOverlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "builtinPrivacyTitle");
  overlay.setAttribute("aria-describedby", "builtinPrivacyIntro");

  const dialog = document.createElement("div");
  dialog.className = "builtinPrivacyDialog";
  overlay.appendChild(dialog);

  const header = document.createElement("header");
  header.className = "builtinPrivacyHeader";
  const title = document.createElement("h2");
  title.id = "builtinPrivacyTitle";
  title.textContent = t("builtinPrivacy.title", "ThreeBox 内置供应商隐私告知");
  header.appendChild(title);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "builtinPrivacyBody";
  const intro = document.createElement("p");
  intro.id = "builtinPrivacyIntro";
  intro.className = "builtinPrivacyLead";
  intro.textContent = t(
    "builtinPrivacy.intro",
    "您必须阅读并同意以下条款，才能使用 ThreeBox 内置供应商。如果您不同意，仍可继续使用 ThreeBox，但需要在设置中自行配置模型供应商。"
  );
  body.appendChild(intro);

  appendSection(
    body,
    "builtinPrivacy.free.title",
    "免费内置供应商",
    "builtinPrivacy.free.body",
    "ThreeBox 提供有使用限额的免费内置供应商，方便您无需配置即可开始使用。为防止滥用并满足服务政策，您通过内置供应商发送的每条用户消息都会先由 ThreeBox 服务器进行内容审核。"
  );

  const moderation = appendSection(
    body,
    "builtinPrivacy.moderation.title",
    "审核范围和处理措施",
    "builtinPrivacy.moderation.body",
    "ThreeBox 服务器不会保存您的完整聊天记录；正常通过审核的消息不会作为聊天内容持久化。服务器会进行敏感词和意图审查，主要包括："
  );
  appendList(moderation, [
    ["builtinPrivacy.moderation.terrorism", "是否涉嫌恐怖主义；"],
    ["builtinPrivacy.moderation.violence", "是否涉嫌暴力或威胁；"],
    ["builtinPrivacy.moderation.sexual", "是否涉嫌色情内容（仅中国大陆地区）；"],
    ["builtinPrivacy.moderation.politics", "是否涉及政治敏感内容（仅中国大陆地区）。"]
  ]);
  appendParagraph(
    moderation,
    "builtinPrivacy.moderation.actions",
    "发现异常时，服务器可能记录必要的审核结果和内容摘要，并根据严重程度采取标记并放行、临时禁言或永久封禁等措施。"
  );

  appendSection(
    body,
    "builtinPrivacy.identity.title",
    "匿名身份标识",
    "builtinPrivacy.identity.body",
    "使用内置供应商时，系统会根据浏览器和设备特征生成匿名身份标识，用于限额、防滥用和执行审核措施。该标识不要求您提供真实姓名或账号。"
  );

  appendSection(
    body,
    "builtinPrivacy.custom.title",
    "您自行添加的供应商",
    "builtinPrivacy.custom.body",
    "您自行添加的模型供应商不会经过上述 ThreeBox 审核链路，也不会与 ThreeBox 的匿名身份标识关联。自定义供应商仍可能执行其自身的内容政策、日志或账号规则；这些行为由相应供应商负责，与 ThreeBox 无关。请遵守所在地法律法规及相应供应商条款。"
  );

  appendSection(
    body,
    "builtinPrivacy.local.title",
    "本地数据和备份",
    "builtinPrivacy.local.body",
    "无论使用内置供应商还是自行添加的供应商，ThreeBox 的设置和聊天记录都保存在您的本地浏览器缓存中，不会作为聊天历史上传至 ThreeBox 服务器。请及时导出并妥善保存重要场景和模型；清理浏览器缓存可能导致会话历史永久丢失。"
  );

  appendParagraph(
    body,
    "builtinPrivacy.declineNote",
    "如果您选择“我拒绝”，内置供应商将被禁用。之后可在供应商设置中点击“查看协议”，重新阅读并作出选择。",
    "builtinPrivacyDeclineNote"
  );
  dialog.appendChild(body);

  const footer = document.createElement("footer");
  footer.className = "builtinPrivacyFooter";
  const declineBtn = document.createElement("button");
  declineBtn.type = "button";
  declineBtn.className = "builtinPrivacyButton builtinPrivacyDecline";
  declineBtn.textContent = t("builtinPrivacy.decline", "我拒绝");
  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "builtinPrivacyButton builtinPrivacyAccept";
  acceptBtn.textContent = t("builtinPrivacy.accept", "我同意");
  footer.appendChild(declineBtn);
  footer.appendChild(acceptBtn);
  dialog.appendChild(footer);

  return { overlay, acceptBtn, declineBtn };
}

export function createBuiltinProviderPrivacyController({ scope, onDecision } = {}) {
  const normalizedScope = scope === "editor" ? "editor" : "threebox";
  let activePromise = null;

  function open() {
    if (activePromise) return activePromise;
    activePromise = new Promise((resolve) => {
      const { overlay, acceptBtn, declineBtn } = buildDialog();
      const previousFocus = document.activeElement;
      let settled = false;
      document.body.appendChild(overlay);
      document.body.classList.add("builtinPrivacyOpen");

      function choose(decision) {
        if (settled) return;
        settled = true;
        setBuiltinPrivacyDecision(normalizedScope, decision);
        overlay.remove();
        document.body.classList.remove("builtinPrivacyOpen");
        previousFocus?.focus?.({ preventScroll: true });
        const callbackResult = onDecision?.(decision);
        activePromise = null;
        resolve(decision);
        Promise.resolve(callbackResult).catch((error) => {
          console.error("[builtin-privacy] decision handler failed:", error);
        });
      }

      acceptBtn.addEventListener("click", () => choose(BUILTIN_PRIVACY_ACCEPTED), { once: true });
      declineBtn.addEventListener("click", () => choose(BUILTIN_PRIVACY_DECLINED), { once: true });
      overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (event.key === "Tab") {
          const first = declineBtn;
          const last = acceptBtn;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      });
      window.setTimeout(() => acceptBtn.focus({ preventScroll: true }), 0);
    });
    return activePromise;
  }

  return {
    open,
    promptIfNeeded() {
      const existing = getBuiltinPrivacyDecision(normalizedScope);
      return existing ? Promise.resolve(existing) : open();
    },
    getDecision: () => getBuiltinPrivacyDecision(normalizedScope),
    isAccepted: () => isBuiltinPrivacyAccepted(normalizedScope)
  };
}
