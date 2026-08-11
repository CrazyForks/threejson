/**
 * ThreeBox — AI scene workbench, built on the published @threejson/* packages, reproducing the
 * original tools/scene-host/threebox UI faithfully (same DOM structure + verbatim threebox.css).
 *
 *   @threejson/host-kit → AI turn orchestration, built-in trial provider, privacy gate, session store
 *   @threejson/react    → useHostI18n, useConversations
 *   threejson           → the engine (createJsonScene per scene card), envelope building, .tjz
 *
 * The chrome (left dock, hero, composer, modals) mirrors the original's markup so the same CSS
 * applies, and each generated scene renders in its own live canvas inside its chat card
 * (SceneCard.jsx), exactly as the original does — there is no shared viewport.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHostI18n } from "@threejson/react/i18n";
import { useConversations } from "@threejson/react/conversations";
import {
  runAiGenerateTurn,
  runAiAdjustTurn,
  classifyAiTurnIntent,
  resolveAiAdjustContextPayload,
  buildResultDigest,
  runAiSceneTitle,
  runAiTurnSummary
} from "@threejson/host-kit/js/aiTurnOrchestrator.js";
import { buildStructuredTurnEnvelope } from "threejson";
import { getAiErrorFeedback } from "@threejson/host-kit/js/aiErrorFeedback.js";
import { isProviderVisionCapable } from "@threejson/host-kit/js/aiTurnOrchestrator.js";
import { resolveSceneHostUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import {
  getAllProjects,
  putProject,
  createProjectId,
  putTurn,
  getConversation,
  putConversation
} from "@threejson/host-kit/js/threeBoxSessionStore.js";
import { t } from "@threejson/host-kit/i18n/index.js";
import { BUILTIN_PROVIDER_TYPE } from "@threejson/host-kit/js/builtinAiProvider.js";
import { formatAgentProgressLabel } from "@threejson/host-kit/js/aiAgentProgressLabels.js";
import { renderMarkdownToSafeHtml } from "./lib/markdown.js";
import { useAiProvider } from "./useAiProvider.js";
import { useResources } from "./useResources.js";
import {
  useThreeBoxSettings,
  getThreeBoxSettings,
  setThreeBoxSettings,
  threeBoxSettingsController,
  updateThreeBoxSettings
} from "./useThreeBoxSettings.js";
import { cloneThreeBoxSettings } from "./lib/threeBoxSettingsStore.js";
import { ensureBuiltinApiKey } from "./lib/threeBoxBuiltinProvider.js";
import { createThreeBoxBuiltinNotifications } from "./lib/threeBoxBuiltinNotifications.js";
import { requestBuiltinNotificationConsent } from "./lib/threeBoxBuiltinNotificationConsentDialog.js";
import { createThreeBoxSelfHostedSync } from "./lib/threeBoxSelfHostedSync.js";
import { createThreeBoxCloudMigration } from "./lib/threeBoxCloudMigration.js";
import { getAllConversations } from "@threejson/host-kit/js/threeBoxSessionStore.js";

// Optional self-hosted sync — a module singleton (its settingsProvider reads live via
// getThreeBoxSettings), shared by the post-turn scheduleSync and the settings "立即同步" button.
const selfHostedSync = createThreeBoxSelfHostedSync(getThreeBoxSettings);
import { PrivacyDialog } from "./PrivacyDialog.jsx";
import { SettingsModal } from "./SettingsModal.jsx";
import { SceneCard } from "./SceneCard.jsx";
import { SceneJsonCollapse, AdjustDiffCollapse } from "./JsonCollapse.jsx";
import { useAttachedContext } from "./useAttachedContext.js";
import { AttachedContextRow } from "./AttachedContextRow.jsx";
import { useComposerAttach, ATTACH_KIND_ORDER } from "./useComposerAttach.js";
import { TemplateCard } from "./TemplateCard.jsx";

/**
 * Ported from threeBoxApp.js's createAgentProgressUpdater. Shows the current stage in the existing
 * compact spinning activity block; `{kind:"stream", previewDelta}` progress is appended as raw
 * stream text. When a draft scene arrives (`stage_preview`/`scene_ready` with a
 * sceneJsonString), `onScenePreview` renders it into the card so the user watches the scene build up.
 */
function createAgentProgressUpdater(setStream, onScenePreview) {
  let streamBuffer = "";
  return (progress) => {
    if (!progress) {
      return;
    }
    if (progress.kind === "stream" && progress.previewDelta) {
      streamBuffer += progress.previewDelta;
      setStream(streamBuffer);
      return;
    }
    if (
      typeof onScenePreview === "function" &&
      typeof progress.sceneJsonString === "string" &&
      (progress.kind === "stage_preview" || progress.kind === "scene_ready")
    ) {
      onScenePreview(progress.sceneJsonString);
    }
    // core/ai/sceneAgent.js's progress messages are plain English — always run `kind` through the
    // shared localized-label mapping instead of showing progress.message directly (see
    // aiAgentProgressLabels.js and threeBoxApp.js's matching fix).
    const label = formatAgentProgressLabel(progress, t);
    if (!label) {
      return;
    }
    setStream(label);
  };
}

/** Ported from threeBoxApp.js's buildAgentProcessSummary — a compact markdown recap of the agent's
 * steps, appended to the assistant message when the agent actually ran. */
function buildAgentProcessSummary(agentResult, heading, budgetMessage) {
  if (!agentResult?.agentUsed || !Array.isArray(agentResult.steps)) {
    return "";
  }
  const noteworthy =
    agentResult.completed === false ||
    agentResult.steps.some((step) =>
      step.ok === false ||
      /(?:repair|fallback|budget)/i.test(String(step.kind || "")) ||
      (step.kind === "capability_review" && step.attempt)
    );
  if (!noteworthy) {
    return "";
  }
  const lines = agentResult.steps.slice(0, 10).map((step, index) => {
    const kind = step.kind || "step";
    const state = step.ok === false ? "failed" : "ok";
    const extra = step.error ? `: ${step.error}` : step.count != null ? ` (${step.count})` : "";
    return `${index + 1}. ${kind} - ${state}${extra}`;
  });
  if (agentResult.completed === false && agentResult.stopReason === "budget_exhausted") {
    lines.unshift(budgetMessage);
  }
  const more =
    agentResult.steps.length > lines.length ? `\n... ${agentResult.steps.length - lines.length} more step(s)` : "";
  return [`**${heading}**`, ...lines, more].filter(Boolean).join("\n");
}

const TEMPLATE_MANIFEST = "assets/json/other/threebox/manifest.json";
const LOGO_URL = resolveSceneHostUrl("assets/img/logo/threejson-logo-256.png");

/** Hero suggestion chips, matching the original's data-prompt / data-prompt-en. */
const HERO_SUGGESTIONS = [
  { zh: "添加一个立方体", en: "Add a cube", promptZh: "创建一个蓝色的立方体", promptEn: "Create a blue cube" },
  {
    zh: "智慧园区场景",
    en: "Smart campus",
    promptZh: "一个智慧园区场景，包含建筑、道路和绿化",
    promptEn: "A smart campus scene with buildings, roads, and greenery"
  },
  {
    zh: "数据中心机房",
    en: "Data center room",
    promptZh: "一个数据中心机房，包含多排机柜",
    promptEn: "A data center room with multiple rows of server racks"
  }
];

const RESOURCE_CATEGORIES = [
  ["all", "全部", "All"],
  ["json", "ThreeJSON", "ThreeJSON"],
  ["tjz", ".tjz", ".tjz"],
  ["model", "三方模型", "Model"],
  ["image", "图片", "Image"],
  ["other", "其他", "Other"]
];

export function App() {
  const { locale, setLocale } = useHostI18n();
  const zh = locale !== "en-US";
  const L = (cn, en) => (zh ? cn : en);
  const provider = useAiProvider();
  const settings = useThreeBoxSettings();

  // Apply the persisted UI-language preference: "auto" leaves whatever the browser resolved to,
  // "zh-CN"/"en-US" force that locale (matching the original's general.locale setting).
  const localeSetting = settings.general.locale;
  useEffect(() => {
    if (localeSetting === "zh-CN" || localeSetting === "en-US") {
      setLocale(localeSetting);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localeSetting]);

  // The composer's model picker chooses among the saved providers; default to the configured
  // default provider, falling back to the first available.
  const providers = settings.ai.providers || [];
  const [selectedProviderId, setSelectedProviderId] = useState(settings.ai.defaultProviderId || "");
  useEffect(() => {
    if (!providers.some((p) => p.id === selectedProviderId)) {
      setSelectedProviderId(settings.ai.defaultProviderId || providers[0]?.id || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ai.providers, settings.ai.defaultProviderId]);

  // Dev-only: adopt a gitignored settings.test.json as a saved provider so the generate/adjust
  // loops can be exercised against a real model locally. Its credentials are served by a dev-server
  // middleware at request time (never bundled) and routed through the Vite proxy (LLM APIs block
  // browser CORS — see vite.config.js). Production builds have neither the endpoint nor the proxy.
  useEffect(() => {
    if (!import.meta.env?.DEV) {
      return;
    }
    let cancelled = false;
    void fetch("/__ai-test-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled || !s?.apiKey) {
          return;
        }
        const DEV_ID = "dev-test-provider";
        const next = cloneThreeBoxSettings(getThreeBoxSettings());
        const entry = {
          id: DEV_ID,
          label: `Dev · ${s.provider || "deepseek"} (settings.test.json)`,
          provider: s.provider || "deepseek",
          baseUrl: "/ai-test-proxy",
          apiKey: s.apiKey,
          model: s.model || ""
        };
        const rest = (next.ai.providers || []).filter((p) => p.id !== DEV_ID);
        next.ai.providers = [entry, ...rest];
        next.ai.defaultProviderId = DEV_ID;
        setThreeBoxSettings(next);
        setSelectedProviderId(DEV_ID);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Include archived so the dock can render the separate "已归档" section (they're filtered out of
  // the main list below).
  const history = useConversations({ includeArchived: true });
  const resources = useResources();

  const [projects, setProjects] = useState([]);
  const [historyMenu, setHistoryMenu] = useState(null); // { conv, x, y }

  useEffect(() => {
    if (typeof indexedDB === "undefined") {
      return;
    }
    void getAllProjects().then((list) => setProjects(Array.isArray(list) ? list : []));
  }, []);

  // Issue/refresh the built-in trial key + quota at boot (a no-op until the privacy agreement is
  // accepted; written into the ai.providers[builtin] entry). Not awaited — never blocks first paint.
  useEffect(() => {
    void ensureBuiltinApiKey(threeBoxSettingsController);
  }, []);

  // Device-scoped built-in notifications: a raw-DOM bell+panel widget with its own polling
  // lifecycle, created once and torn down on unmount (poll() no-ops unless enabled + a trial key
  // exists). It reads settings live via getThreeBoxSettings.
  const notificationsRef = useRef(null);
  useEffect(() => {
    const instance = createThreeBoxBuiltinNotifications(getThreeBoxSettings);
    notificationsRef.current = instance;
    instance.start();
    return () => {
      instance.stop();
      notificationsRef.current = null;
    };
  }, []);
  // Re-poll whenever the enable toggle flips so the bell reflects the new state promptly.
  useEffect(() => {
    void notificationsRef.current?.refresh();
  }, [settings.general.builtinNotificationsEnabled]);

  // One-time consent prompt: after the built-in privacy agreement is accepted and no notification
  // decision has been recorded yet, ask once and persist the choice (matching the original's boot
  // flow). `provider.privacyAccepted` comes from useAiProvider.
  const notifDecisionMade = settings.general.builtinNotificationsDecisionMade;
  useEffect(() => {
    if (!provider.privacyAccepted || notifDecisionMade) {
      return;
    }
    let cancelled = false;
    void requestBuiltinNotificationConsent().then((enabled) => {
      if (cancelled) {
        return;
      }
      updateThreeBoxSettings((next) => {
        next.general.builtinNotificationsEnabled = enabled;
        next.general.builtinNotificationsDecisionMade = true;
      });
      void notificationsRef.current?.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [provider.privacyAccepted, notifDecisionMade]);

  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState("");
  const [shownSceneJson, setShownSceneJson] = useState(null);
  const [shownTurnId, setShownTurnId] = useState(null);
  const [modeOverride, setModeOverride] = useState(null);

  // Chrome state.
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [mobilePeek, setMobilePeek] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState("general");
  const [showPrivacy, setShowPrivacy] = useState(false);

  const openSettings = useCallback((section = "general") => {
    setSettingsSection(section);
    setShowSettings(true);
  }, []);

  /** Cloud migration (account-service, deliberately independent of the built-in-provider endpoint):
   * confirm, then hand an encrypted local snapshot to ThreeBox Cloud and redirect; with no local
   * conversations just open Cloud. Matches the original's openCloud action. */
  const migrateToCloud = useCallback(async () => {
    try {
      const conversations = await getAllConversations();
      if (
        conversations.length &&
        window.confirm(
          L(
            "将本机对话加密转交给 ThreeBox Cloud，并在登录后导入？",
            "Encrypt and hand this device's conversations to ThreeBox Cloud, importing after login?"
          )
        )
      ) {
        const cloud = createThreeBoxCloudMigration({
          apiBaseUrl: "https://api.threebox.org",
          cloudUrl: "https://cloud.threebox.org"
        });
        await cloud.migrate();
      } else {
        window.location.assign("https://cloud.threebox.org");
      }
    } catch (error) {
      showToast(L(`迁移失败：${error?.message || error}`, `Migration failed: ${error?.message || error}`), "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zh]);
  const [showSearch, setShowSearch] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [resourceCategory, setResourceCategory] = useState("all");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templates, setTemplates] = useState([]);
  const [templateBusyId, setTemplateBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const composerRef = useRef(null);
  const peekHideTimer = useRef(null);

  // Desktop hover-peek: when the dock is unpinned, hovering the left edge/flyout reveals it and
  // moving away hides it after a short delay (matching the original's leftFlyoutHost mouseenter/
  // mouseleave). Touch devices don't fire hover, so this is naturally desktop-only.
  const onFlyoutEnter = useCallback(() => {
    if (sidebarPinned) {
      return;
    }
    clearTimeout(peekHideTimer.current);
    setMobilePeek(true);
  }, [sidebarPinned]);
  const onFlyoutLeave = useCallback(() => {
    if (sidebarPinned) {
      return;
    }
    clearTimeout(peekHideTimer.current);
    peekHideTimer.current = setTimeout(() => setMobilePeek(false), 220);
  }, [sidebarPinned]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, stream]);

  // Template manifest (rendered into the sidebar's template-gallery section, like the original).
  useEffect(() => {
    let cancelled = false;
    fetch(resolveSceneHostUrl(TEMPLATE_MANIFEST))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) {
          setTemplates(Array.isArray(data?.items) ? data.items : []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const showToast = useCallback((text, kind = "info") => setToast({ text, kind }), []);

  const append = useCallback((msg) => setMessages((prev) => [...prev, msg]), []);

  /** Patch a message in place by id (used to fill in the async scene title / recap after the card
   * has already rendered — the original never blocks the visible card on those AI round-trips). */
  const updateMessage = useCallback(
    (id, patch) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    []
  );

  // Human-readable language name for the recap/title AI prompts (core/ai's `responseLanguage`),
  // matching the original's resolveSummaryResponseLanguage / resolveSceneTitleLanguage.
  const summaryResponseLanguage = zh ? "Simplified Chinese" : "English";
  const resolveTitleLanguage = () => {
    const pref = settings.ai.sceneTitleLanguage || "auto";
    if (pref === "zh-CN") return "Simplified Chinese";
    if (pref === "en-US") return "English";
    return summaryResponseLanguage;
  };

  // Attached-scene context row above the composer (a template/resource/upload consumed as context
  // for the next message). Which provider is active drives the image-upload vision gate.
  const attachedContext = useAttachedContext();
  const [attachMenuPos, setAttachMenuPos] = useState(null); // { x, y } for the attach-type menu

  const activeProvider = useMemo(() => {
    const list = settings.ai.providers || [];
    return (
      list.find((p) => p.id === selectedProviderId) ||
      list.find((p) => p.id === settings.ai.defaultProviderId) ||
      list[0] ||
      null
    );
  }, [settings.ai.providers, settings.ai.defaultProviderId, selectedProviderId]);

  const composerAttach = useComposerAttach({
    attachedContext,
    showToast,
    onResourceAdded: () => void resources.refresh(),
    getVisionCapable: () => isProviderVisionCapable({ provider: activeProvider?.provider })
  });

  // Scene-card behaviour driven by settings: auxiliary preview lights, the post-mesh-export warning
  // dialog, and the export-JSON indent.
  const sceneCardOptions = useMemo(
    () => ({
      previewAuxiliaryLights: settings.general.previewAuxiliaryLights,
      showMeshExportWarnings: settings.io.showMeshExportWarnings,
      exportJsonIndent: settings.io.exportJsonIndent
    }),
    [settings.general.previewAuxiliaryLights, settings.io.showMeshExportWarnings, settings.io.exportJsonIndent]
  );

  const openConversation = useCallback(
    async (id) => {
      history.setActiveId(id);
      setMobilePeek(false);
      const turns = await history.loadTurns(id);
      const replayed = [];
      for (const turn of turns) {
        replayed.push({ id: `${turn.id}-u`, role: "user", text: turn.userPrompt || "" });
        if (turn.status === "failed" || turn.stage === "error") {
          replayed.push({ id: `${turn.id}-e`, role: "error", text: turn.errorMessage || "This turn failed." });
        } else {
          // Parse the stored snapshot once here so each card gets a stable object reference (a fresh
          // parse on every React render would re-render the live canvas every frame).
          let sceneObj = null;
          try {
            sceneObj = turn.sceneJson ? JSON.parse(turn.sceneJson) : null;
          } catch {
            sceneObj = null;
          }
          replayed.push({
            id: `${turn.id}-a`,
            role: "assistant",
            text: turn.sceneTitle || L("场景已生成。", "Scene generated."),
            sceneObj,
            sceneJson: turn.sceneJson || null,
            label: turn.sceneTitle || turn.userPrompt || "",
            summary: turn.recapSummary || null,
            turnId: turn.id,
            mode: turn.mode || "generate"
          });
        }
      }
      setMessages(replayed);

      // The scene an adjust targets is the conversation's latest stored snapshot.
      const latest = [...turns].reverse().find((t) => t.sceneJson);
      if (latest) {
        setShownSceneJson(latest.sceneJson);
        setShownTurnId(latest.id);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, append]
  );

  const startNewConversation = useCallback(() => {
    history.setActiveId(null);
    setMessages([]);
    setShownSceneJson(null);
    setShownTurnId(null);
    setMobilePeek(false);
  }, [history]);

  /** Attach a saved resource (a loadable json/tjz/model scene) to the composer context row, like
   * the original's resource library. Non-scene resources (image/other) aren't attachable. */
  const attachResource = useCallback(
    (res) => {
      if (!res.sceneJson) {
        return;
      }
      let sceneObj = null;
      try {
        sceneObj = JSON.parse(res.sceneJson);
      } catch {
        return;
      }
      attachedContext.setTemplate({ id: res.id, title: res.name }, sceneObj);
      showToast(L(`已附加：${res.name}`, `Attached: ${res.name}`));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachedContext, zh]
  );

  const pickTemplate = useCallback(
    async (item) => {
      const title = (zh ? item.title : item.titleEn) || item.title || item.id;
      setTemplateBusyId(item.id);
      try {
        const text = await fetch(resolveSceneHostUrl(item.json)).then((r) =>
          r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))
        );
        // Faithful to the original: picking a template attaches it to the composer's context row
        // (consumed as a seed on the next send), rather than loading it as the current chat.
        attachedContext.setTemplate({ id: item.id, title }, JSON.parse(text));
        showToast(L(`已附加模板：${title}`, `Attached template: ${title}`));
      } catch (error) {
        showToast(L(`模板载入失败：${error.message}`, `Could not load template: ${error.message}`), "error");
      } finally {
        setTemplateBusyId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachedContext, zh]
  );

  const togglePin = useCallback(
    async (conv) => {
      await history.update(conv.id, { pinned: !conv.pinned });
      showToast(conv.pinned ? L("已取消置顶", "Unpinned") : L("已置顶", "Pinned"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history]
  );

  const toggleArchive = useCallback(
    async (conv) => {
      await history.update(conv.id, { archived: !conv.archived });
      showToast(conv.archived ? L("已取消归档", "Unarchived") : L("已归档", "Archived"));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history]
  );

  const moveToProject = useCallback(
    async (conv, projectId) => {
      await history.update(conv.id, { projectId });
      showToast(L("已移动。", "Moved."));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history]
  );

  const removeConversation = useCallback(
    async (conv) => {
      if (!window.confirm(L(`确定删除聊天"${conv.title || "未命名"}"吗？此操作无法撤销。`, `Delete "${conv.title || "Untitled"}"? This cannot be undone.`))) {
        return;
      }
      await history.remove(conv.id);
      if (history.activeId === conv.id) {
        startNewConversation();
      }
      showToast(L("聊天已删除。", "Conversation deleted."));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, startNewConversation]
  );

  const createProject = useCallback(async () => {
    const name = (window.prompt(L("新建项目名称：", "New project name:"), "") || "").trim();
    if (!name) {
      return;
    }
    const project = { id: createProjectId(), name };
    await putProject(project);
    setProjects((prev) => [...prev, project]);
    showToast(L(`已新建项目「${name}」。`, `Created project "${name}".`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zh]);

  // Split conversations for the dock: the main list is unarchived; archived get their own section.
  const activeConversations = useMemo(
    () => history.conversations.filter((c) => !c.archived),
    [history.conversations]
  );
  const archivedConversations = useMemo(
    () => history.conversations.filter((c) => c.archived),
    [history.conversations]
  );

  // An attached scene also makes the next turn an adjust (it becomes the current scene as a seed).
  const canAdjust = Boolean(shownSceneJson) || Boolean(attachedContext.current);
  const isAdjust = canAdjust && modeOverride !== "generate";

  /**
   * Resolves providerOptions for the currently-selected saved provider (composer picker → default →
   * first). The built-in trial provider is device-bound (privacy gate + issued key) so it delegates
   * to useAiProvider; the user's own providers resolve straight from their settings entry.
   * @returns {Promise<{ready:boolean, reason?:string, options?:object}>}
   */
  const resolveActiveProviderOptions = useCallback(async () => {
    const list = settings.ai.providers || [];
    const active =
      list.find((p) => p.id === selectedProviderId) ||
      list.find((p) => p.id === settings.ai.defaultProviderId) ||
      list[0];
    if (!active) {
      return { ready: false, reason: "no-provider" };
    }
    if (active.provider === BUILTIN_PROVIDER_TYPE) {
      // The built-in trial key/quota live in the settings provider entry, auto-managed by
      // threeBoxBuiltinProvider. Ensure it's issued (privacy-gated), then read the fresh key.
      if (!provider.privacyAccepted) {
        return { ready: false, reason: "privacy" };
      }
      await ensureBuiltinApiKey(threeBoxSettingsController);
      const fresh = (getThreeBoxSettings().ai.providers || []).find((p) => p.id === active.id);
      const key = String(fresh?.apiKey || "").trim();
      if (!key) {
        return { ready: false, reason: "issue-failed" };
      }
      return {
        ready: true,
        options: { provider: BUILTIN_PROVIDER_TYPE, apiKey: key, baseUrl: settings.ai.builtinBackendUrl || undefined }
      };
    }
    if (!String(active.apiKey || "").trim()) {
      return { ready: false, reason: "missing-key" };
    }
    return {
      ready: true,
      options: {
        provider: active.provider || "chatgpt",
        apiKey: String(active.apiKey).trim(),
        baseUrl: String(active.baseUrl || "").trim() || undefined,
        model: String(active.model || "").trim() || undefined
      }
    };
  }, [settings.ai.providers, settings.ai.defaultProviderId, settings.ai.builtinBackendUrl, selectedProviderId, provider]);

  const send = useCallback(
    async (text) => {
      const userPrompt = String(text || "").trim();
      if (!userPrompt || busy) {
        return;
      }

      const resolved = await resolveActiveProviderOptions();
      if (!resolved.ready) {
        if (resolved.reason === "privacy") {
          setShowPrivacy(true);
        } else if (resolved.reason === "missing-key" || resolved.reason === "no-provider") {
          openSettings("ai");
        } else {
          append({
            role: "error",
            text: `${L("无法连接内置供应商", "Could not reach the built-in provider")}${
              provider.issueError ? `: ${provider.issueError.message}` : "."
            } ${L("请在设置中配置你自己的供应商。", "Configure your own provider in Settings.")}`
          });
        }
        return;
      }

      append({ role: "user", text: userPrompt });
      setPrompt("");
      setBusy(true);
      setStream("");

      let conversationId = history.activeId;
      if (!conversationId) {
        const created = await history.create({
          title: userPrompt.length > 48 ? `${userPrompt.slice(0, 48)}…` : userPrompt
        });
        conversationId = created.id;
      }

      // Consume an attached scene as a seed turn: render it verbatim (no AI call), cache it, and
      // make it the scene the user's message adjusts — exactly like the original's
      // consumeAttachedContextAsSeedTurn.
      let seedSceneJson = null;
      const attached = attachedContext.get();
      if (attached) {
        attachedContext.clear();
        seedSceneJson = JSON.stringify(attached.sceneJson);
        append({
          role: "assistant",
          text: L(`已应用「${attached.label}」作为上下文。`, `Applied "${attached.label}" as context.`),
          sceneObj: attached.sceneJson,
          sceneJson: seedSceneJson,
          label: attached.label
        });
        await history.appendTurn(conversationId, {
          userPrompt: L(`(模板) ${attached.label}`, `(template) ${attached.label}`),
          mode: "generate",
          stage: "generate",
          sceneJson: seedSceneJson,
          sceneTitle: attached.label
        });
        setShownSceneJson(seedSceneJson);
        setShownTurnId(null);
      }

      const controller = new AbortController();
      abortRef.current = controller;
      const turnDeadlineAt = Date.now() + 180000;
      const sceneProviderOptions = { ...resolved.options, turnDeadlineAt };
      const adjustTargetString = seedSceneJson || shownSceneJson;
      const adjusting = modeOverride !== "generate" && Boolean(adjustTargetString);

      // Direct generation is the default. This budget is only a runaway guard when core/ai
      // escalates a genuinely complex/output-limited scene to incremental construction.
      const agentOptions = { maxRefineRounds: settings.ai.maxAutoRefineRounds };
      // The assistant card is always appended up-front now (so drafts can stream into it) and
      // finalized in place after the turn — there is no more "append once at the end" path.
      const assistantId = crypto?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const onScenePreview = (draftString) => {
        let obj = null;
        try {
          obj = JSON.parse(draftString);
        } catch {
          return;
        }
        updateMessage(assistantId, { sceneObj: obj, sceneJson: draftString });
      };
      const onAgentProgress = createAgentProgressUpdater(setStream, onScenePreview);
      append({
        id: assistantId,
        role: "assistant",
        text: L("正在生成…", "Generating…"),
        sceneObj: null,
        sceneJson: null,
        label: userPrompt,
        summary: null,
        mode: adjusting ? "adjust" : "generate"
      });

      try {
        let sceneJson;
        let sceneJsonString;
        let stage = "generate";
        // For adjust turns, the raw output the model applied (operation commands or a JSON Patch),
        // surfaced under the card in a collapse — exactly like the original's diff collapse.
        let diff = null;
        let agentResult = null;

        if (adjusting) {
          // Adjust behaviour follows the persisted AI settings: which output form to try first
          // (operation commands / JSON Patch / full JSON) and how much of the target scene to
          // attach as context (spatial summary and/or full JSON).
          const adjustContextSettings = {
            includeSpatialSummary: settings.ai.includeSpatialSummary,
            includeFullJson: settings.ai.includeFullJson
          };
          const targetSceneJson = JSON.parse(adjustTargetString);
          const envelope = buildStructuredTurnEnvelope({
            userPrompt,
            intent: "adjust",
            targetTurnId: shownTurnId,
            contextPayload: resolveAiAdjustContextPayload(targetSceneJson, adjustContextSettings),
            includeReferenceLinks: settings.ai.attachReferenceLinks,
            globalPromptPrefix: settings.ai.globalPromptPrefix || undefined
          });
          const result = await runAiAdjustTurn({
            userPrompt,
            envelope,
            targetSceneJsonString: adjustTargetString,
            providerOptions: sceneProviderOptions,
            updateOutputMode: settings.ai.updateOutputMode,
            resolveContextPayload: (json) => resolveAiAdjustContextPayload(json, adjustContextSettings),
            agentOptions,
            onAgentProgress,
            onDelta: (delta) => setStream((prev) => prev + delta),
            locale,
            signal: controller.signal
          });
          sceneJson = result.sceneJson;
          sceneJsonString = result.sceneJsonString;
          stage = result.stage;
          agentResult = result.agentResult || null;
          if (result.stage === "commands" && Array.isArray(result.commands)) {
            diff = { kind: "commands", text: JSON.stringify(result.commands, null, 2) };
          } else if (Array.isArray(result.patch) && result.patch.length > 0) {
            diff = { kind: "patch", text: JSON.stringify(result.patch, null, 2) };
          }
        } else {
          const negotiation = await classifyAiTurnIntent(
            { userPrompt, history: [] },
            {
              ...sceneProviderOptions,
              signal: controller.signal,
              animationCapabilityMode: settings.ai.animationCapabilityMode || "auto",
              sceneGenerationMode: settings.ai.sceneGenerationMode || "auto"
            }
          );
          const result = await runAiGenerateTurn({
            userPrompt,
            providerOptions: sceneProviderOptions,
            locale,
            signal: controller.signal,
            // Persisted AI settings: a global prompt prefix prepended to every request, whether to
            // attach ThreeJSON doc/example reference links, online-texture hints, and the segmented
            // continuation cap.
            globalPromptPrefix: settings.ai.globalPromptPrefix || undefined,
            includeReferenceLinks: settings.ai.attachReferenceLinks,
            onlineTextureHints: settings.ai.onlineTextureHints,
            maxSceneSegments: settings.ai.maxSceneSegments,
            generationStrategy: negotiation.generationStrategy,
            executionMode: negotiation.executionMode,
            refinementGoals: negotiation.refinementGoals,
            estimatedSegments: negotiation.estimatedSegments,
            selectedCapabilityIds: negotiation.selectedCapabilityIds,
            requiresAnimation: negotiation.requiresAnimation,
            agentOptions,
            onAgentProgress,
            // Kept for API compatibility. The multi-call agent reports stage progress and scene
            // previews instead of concatenating raw deltas from unrelated model calls.
            onDelta: (delta) => setStream((prev) => prev + delta),
            onSceneDraft: onScenePreview,
            onGenerationPhase: (phase) => {
              if (phase?.phase === "compact-retry") {
                setStream(L("输出过长，正在简化场景并重新生成…", "Output too long — simplifying and regenerating the scene…"));
              } else if (phase?.phase === "processing") {
                setStream(L("正在解析生成的 JSON 并准备场景…", "Parsing the generated JSON and preparing the scene…"));
              } else if (phase?.phase === "capability-review") {
                setStream(L("正在校验场景是否充分使用相关能力…", "Checking whether the scene makes full use of relevant capabilities…"));
              }
            }
          });
          sceneJson = result.sceneJson;
          sceneJsonString = result.sceneJsonString;
          agentResult = result.agentResult || null;
        }

        setStream("");
        const snapshot = sceneJsonString ?? JSON.stringify(sceneJson);
        const verifiedAdjustSummary = adjusting && settings.ai.includeTurnSummary
          ? L(`已通过 ${stage} 调整了场景。`, `Adjusted the scene via ${stage}.`)
          : "";
        const turnRecord = await history.appendTurn(conversationId, {
          userPrompt,
          mode: adjusting ? "adjust" : "generate",
          targetTurnId: adjusting ? shownTurnId : undefined,
          stage,
          sceneJson: snapshot,
          sceneTitle: "",
          recapSummary: verifiedAdjustSummary
        });
        const baseText = adjusting ? L(`场景已调整（${stage}）。`, `Scene adjusted (${stage}).`) : L("场景已生成。", "Scene generated.");
        // Only show a recap when adaptive execution actually performed meaningful extra work.
        const agentProcess = buildAgentProcessSummary(
          agentResult,
          L("Agent 过程", "Agent process"),
          L(
            "已达到自动细化轮数上限；当前场景可用，但 AI 未明确确认已经完善完成。",
            "The automatic refinement limit was reached. The scene is usable, but the AI did not explicitly confirm completion."
          )
        );
        const finalFields = {
          text: agentProcess ? `${baseText}\n\n${agentProcess}` : baseText,
          // The orchestrator already handed us the parsed scene object; the message's own SceneCard
          // renders it into its own live canvas (there is no shared viewport).
          sceneObj: sceneJson,
          sceneJson: snapshot,
          diff,
          label: userPrompt,
          turnId: turnRecord?.id ?? null,
          mode: adjusting ? "adjust" : "generate",
          summary: verifiedAdjustSummary || undefined
        };
        // The card was appended early and streamed drafts (see above) — finalize it in place so
        // the last draft is superseded by the real result.
        updateMessage(assistantId, finalFields);
        setShownSceneJson(snapshot);
        setShownTurnId(turnRecord?.id ?? null);
        // Debounced push to the user's self-hosted sync server (no-op unless configured).
        selfHostedSync.scheduleSync();

        // Generation title/recap remain best-effort background calls. Adjustments use the verified
        // stage above instead of asking another model call to guess what changed from a thin digest.
        if (!adjusting && (settings.ai.autoGenerateSceneTitle || settings.ai.includeTurnSummary)) {
          const digest = buildResultDigest(sceneJson);
          const providerOptions = resolved.options;
          const turnMode = adjusting ? "adjust" : "generate";
          const adjustTargetTurnId = adjusting ? shownTurnId : undefined;
          void (async () => {
            const [title, recap] = await Promise.all([
              settings.ai.autoGenerateSceneTitle
                ? runAiSceneTitle({
                    userPrompt,
                    resultDigest: digest,
                    providerOptions,
                    responseLanguage: resolveTitleLanguage()
                  }).catch(() => "")
                : Promise.resolve(""),
              settings.ai.includeTurnSummary
                ? runAiTurnSummary({
                    userPrompt,
                    mode: turnMode,
                    targetTurnId: adjustTargetTurnId,
                    turnId: turnRecord?.id,
                    resultDigest: digest,
                    providerOptions,
                    responseLanguage: summaryResponseLanguage,
                    selfName: settings.ai.selfName || "ThreeBox"
                  }).catch(() => "")
                : Promise.resolve("")
            ]);
            const recapText = settings.ai.includeTurnSummary
              ? recap || L("已根据您的描述生成场景。", "Generated a scene from your description.")
              : "";
            const patch = {};
            if (title) {
              patch.label = title;
            }
            if (recapText) {
              patch.summary = recapText;
            }
            if (Object.keys(patch).length) {
              updateMessage(assistantId, patch);
            }
            if (title) {
              // Write straight to the store (read-merge-write) rather than history.update: that
              // hook method bails when the conversation isn't in its in-memory list, and this async
              // block runs seconds later against a `history` captured before the conversation was
              // created. Refresh afterwards so the sidebar reflects the new title.
              try {
                const conv = await getConversation(conversationId);
                if (conv) {
                  await putConversation({ ...conv, title, updatedAt: Date.now() });
                  await history.refresh();
                }
              } catch {
                /* best-effort */
              }
            }
            if (turnRecord?.id && (title || recapText)) {
              void putTurn({ ...turnRecord, sceneTitle: title || turnRecord.sceneTitle || "", recapSummary: recapText }).catch(() => {});
            }
          })();
        }
      } catch (error) {
        setStream("");
        if (error?.name === "AbortError") {
          const stoppedText = L("生成已停止。", "Generation stopped.");
          // If the agent card was appended early, finalize it in place rather than orphaning the
          // "正在生成…" placeholder; otherwise append a fresh notice.
          if (assistantId) {
            updateMessage(assistantId, { text: stoppedText });
          } else {
            append({ role: "assistant", text: stoppedText });
          }
        } else {
          const message = getAiErrorFeedback(error).message;
          if (assistantId) {
            // Convert the early agent placeholder into the error in place (drop its draft card).
            updateMessage(assistantId, { role: "error", text: message, sceneObj: null, sceneJson: null, diff: null });
          } else {
            append({ role: "error", text: message });
          }
          await history.appendTurn(conversationId, {
            userPrompt,
            mode: adjusting ? "adjust" : "generate",
            targetTurnId: adjusting ? shownTurnId : undefined,
            stage: "error",
            status: "failed",
            errorMessage: message,
            sceneJson: null
          });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, provider, locale, append, updateMessage, history, isAdjust, modeOverride, shownSceneJson, shownTurnId, zh, resolveActiveProviderOptions, settings.ai, attachedContext]
  );

  const onComposerKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(prompt);
    }
  };

  const filteredResources = useMemo(
    () =>
      resourceCategory === "all"
        ? resources.resources
        : resources.resources.filter((r) => r.kind === resourceCategory),
    [resources.resources, resourceCategory]
  );

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) {
      return templates;
    }
    return templates.filter((t) =>
      `${t.title || ""} ${t.titleEn || ""} ${t.id}`.toLowerCase().includes(q)
    );
  }, [templates, templateSearch]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return history.conversations;
    }
    return history.conversations.filter((c) => (c.title || "").toLowerCase().includes(q));
  }, [history.conversations, searchQuery]);

  const hasMessages = messages.length > 0;
  const rootClass = [
    "rootContainer",
    sidebarPinned ? "leftDockPinned" : "",
    mobilePeek ? "leftDockPeek" : ""
  ]
    .filter(Boolean)
    .join(" ");

  /** One history row, shared by the main list, project groups, and the archived section. The ⋯ menu
   * button opens a context menu positioned at the button (pin / archive / move-to-project / delete). */
  const renderHistoryItem = (conv) => (
    <div
      key={conv.id}
      className={`historyItem${history.activeId === conv.id ? " active" : ""}${conv.pinned ? " pinned" : ""}`}
      onClick={() => void openConversation(conv.id)}
    >
      {conv.pinned && <span className="historyItemPin" aria-hidden="true">📌</span>}
      <div className="historyItemBody">
        <div className="historyItemTitle">{conv.title || L("未命名", "Untitled")}</div>
        <div className="historyItemMeta">{new Date(conv.updatedAt).toLocaleDateString()}</div>
      </div>
      <button
        className="historyItemMenuBtn"
        type="button"
        title={L("更多", "More")}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setHistoryMenu({ conv, x: rect.right, y: rect.bottom });
        }}
      >
        ⋯
      </button>
    </div>
  );

  return (
    <div id="rootContainer" className={rootClass}>
      <div
        className="flyoutHost flyoutHostLeft"
        id="leftFlyoutHost"
        onMouseEnter={onFlyoutEnter}
        onMouseLeave={onFlyoutLeave}
      >
        <div className="edgeHoverZone edgeHoverZoneLeft" />
        <aside className="leftDock">
          <div className="sidebarHeaderRow">
            <a className="brand" href="#/" onClick={(e) => e.preventDefault()}>
              <img src={LOGO_URL} alt="ThreeJSON" />
              <span className="brandText">
                <span className="brandTitle">ThreeBox</span>
                <span className="brandSubtitle">{L("由 ThreeJSON 驱动", "Powered by ThreeJSON")}</span>
              </span>
            </a>
          </div>
          <div className="sidebarPinRow">
            <button
              className="sidebarPinBtn"
              type="button"
              aria-pressed={sidebarPinned}
              aria-label={L("钉住侧栏", "Pin sidebar")}
              onClick={() => setSidebarPinned((v) => !v)}
            >
              <svg className="sidebarPinIcon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 1.6 9.4 5.5 13.3 6.4 9.4 7.3 8 11.2 6.6 7.3 2.7 6.4 6.6 5.5 8 1.6z"
                />
                <path fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" d="M8 10.2v4.2" />
              </svg>
            </button>
          </div>

          <div className="sidebarBody">
            <nav className="sidebarNav">
              <button className="sidebarNavBtn" type="button" onClick={() => openSettings("ai")}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8 3.6 3.6"
                  />
                </svg>
                <span>{L("AI 配置", "AI config")}</span>
              </button>
              <button className="sidebarNavBtn" type="button" onClick={startNewConversation}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="M8 2.5v11M2.5 8h11" />
                </svg>
                <span>{L("新聊天", "New chat")}</span>
              </button>
              <button className="sidebarNavBtn" type="button" onClick={() => setShowSearch(true)}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="6.8" cy="6.8" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" d="m9.8 9.8 3.3 3.3" />
                </svg>
                <span>{L("搜索聊天", "Search")}</span>
              </button>
            </nav>

            <details className="sidebarSection" id="resourceLibrarySection">
              <summary className="sidebarSectionTitle">{L("资源库", "Library")}</summary>
              <div className="sidebarSectionBody">
                <div className="resourceCategoryTabs">
                  {RESOURCE_CATEGORIES.map(([key, cn, en]) => (
                    <button
                      key={key}
                      type="button"
                      className={`resourceCategoryTab${resourceCategory === key ? " active" : ""}`}
                      onClick={() => setResourceCategory(key)}
                    >
                      {L(cn, en)}
                    </button>
                  ))}
                </div>
                <div className="resourceList">
                  {filteredResources.length === 0 && (
                    <div className="historyEmpty">{L("暂无资源。", "No resources yet.")}</div>
                  )}
                  {filteredResources.map((res) => (
                    <div
                      key={res.id}
                      className={`resourceItem${res.sceneJson ? " resourceItemLoadable" : ""}`}
                      onClick={() => attachResource(res)}
                    >
                      <div className="resourceItemIcon" aria-hidden="true">
                        {res.kind === "image" ? "🖼" : res.kind === "model" ? "◆" : "{ }"}
                      </div>
                      <div className="resourceItemInfo">
                        <div className="resourceItemName">{res.name}</div>
                        <div className="resourceItemMeta">
                          {res.kind}
                          {res.sceneJson ? ` · ${(res.sceneJson.length / 1024).toFixed(1)} KB` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="resourceItemRemoveBtn"
                        title={L("删除", "Delete")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void resources.remove(res.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </details>

            <details className="sidebarSection" open>
              <summary className="sidebarSectionTitle">{L("模板库", "Templates")}</summary>
              <div className="sidebarSectionBody">
                <input
                  type="search"
                  className="sidebarSearchInput"
                  placeholder={L("搜索模板...", "Search templates...")}
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                />
                <div className="templateGrid">
                  {filteredTemplates.map((item) => (
                    <TemplateCard
                      key={item.id}
                      item={item}
                      label={(zh ? item.title : item.titleEn) || item.title}
                      busy={templateBusyId === item.id}
                      onSelect={() => void pickTemplate(item)}
                    />
                  ))}
                </div>
              </div>
            </details>

            <details className="sidebarSection">
              <summary className="sidebarSectionTitle">{L("应用", "Apps")}</summary>
              <div className="sidebarSectionBody">
                <a className="appLinkCard" href="http://localhost:5183" target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2 12.5 10.5 4 12 5.5 3.5 14H2v-1.5z"
                    />
                    <path fill="none" stroke="currentColor" strokeWidth="1.3" d="m9.3 5.2 1.5 1.5" />
                  </svg>
                  <span>{L("场景编辑器", "Scene editor")}</span>
                </a>
                <a className="appLinkCard" href="http://localhost:5180" target="_blank" rel="noopener noreferrer">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                    <path fill="currentColor" d="M6.6 5.4 11 8l-4.4 2.6V5.4z" />
                  </svg>
                  <span>{L("场景播放器", "Scene player")}</span>
                </a>
              </div>
            </details>

            <details className="sidebarSection">
              <summary className="sidebarSectionTitle">{L("项目", "Projects")}</summary>
              <div className="sidebarSectionBody">
                <div className="projectList">
                  {projects.length === 0 && <div className="historyEmpty">{L("暂无项目。", "No projects yet.")}</div>}
                  {projects.map((proj) => {
                    const inProject = activeConversations.filter((c) => c.projectId === proj.id);
                    return (
                      <details className="projectItem" key={proj.id}>
                        <summary className="projectItemTitle">
                          {proj.name} <span className="projectItemCount">{inProject.length}</span>
                        </summary>
                        {inProject.map((conv) => renderHistoryItem(conv))}
                      </details>
                    );
                  })}
                </div>
                <button className="sidebarInlineBtn" type="button" onClick={() => void createProject()}>
                  {L("+ 新建项目", "+ New project")}
                </button>
              </div>
            </details>

            <div className="sidebarSectionTitle sidebarHistoryTitle">{L("聊天历史", "History")}</div>
            <div className="historyList">
              {history.loading && <div className="historyEmpty">{L("加载历史…", "Loading history…")}</div>}
              {!history.loading && activeConversations.length === 0 && (
                <div className="historyEmpty">
                  {history.persistent
                    ? L("暂无对话。", "No conversations yet.")
                    : L("此浏览器模式下历史不可用。", "History unavailable in this browser mode.")}
                </div>
              )}
              {activeConversations.filter((c) => !c.projectId).map((conv) => renderHistoryItem(conv))}
            </div>

            {archivedConversations.length > 0 && (
              <details className="sidebarSection sidebarArchiveSection">
                <summary className="sidebarSectionTitle">{L("已归档", "Archived")}</summary>
                <div className="historyList">
                  {archivedConversations.map((conv) => renderHistoryItem(conv))}
                </div>
              </details>
            )}
          </div>

          <div className="sidebarFooter">
            <button className="userMenuBtn" type="button" onClick={() => setUserMenuOpen((v) => !v)}>
              <span className="userAvatar">U</span>
              <span className="userName">{L("访客用户", "Guest")}</span>
            </button>
            {userMenuOpen && (
              <div className="userMenuPanel">
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    openSettings("general");
                  }}
                >
                  {L("设置", "Settings")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void migrateToCloud();
                  }}
                >
                  {L("云端", "Cloud")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setShowHelp(true);
                  }}
                >
                  {L("帮助", "Help")}
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      <main id="mainArea" className="mainArea">
        <button
          type="button"
          className="mobileMenuBtn"
          aria-label={L("菜单", "Menu")}
          onClick={() => setMobilePeek((v) => !v)}
        >
          <svg viewBox="0 0 18 14" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M1 1.5h16M1 7h16M1 12.5h16" />
          </svg>
        </button>

        <div className="chatMessages" hidden={!hasMessages}>
          {messages.map((m, i) => {
            const role = m.role === "user" ? "user" : "assistant";
            return (
              <div key={m.id ?? i} className={`chatMessage chatMessage${role === "user" ? "User" : "Assistant"}`}>
                <div className={`chatMessageAvatar chatMessageAvatar${role === "user" ? "User" : "Assistant"}`}>
                  {role === "user" ? "U" : <img src={LOGO_URL} alt="ThreeBox" />}
                </div>
                <div className="chatMessageBody">
                  {m.role === "assistant" ? (
                    // Assistant text may embed AI-authored (untrusted) content — render it as
                    // sanitized markdown, exactly like the original (renderMarkdownToSafeHtml).
                    <div
                      className="chatMessageText markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(m.text) }}
                    />
                  ) : (
                    <div className={`chatMessageText${m.role === "error" ? " chatMessageError" : ""}`}>{m.text}</div>
                  )}
                  {m.sceneObj && <SceneCard sceneJson={m.sceneObj} label={m.label} showToast={showToast} options={sceneCardOptions} />}
                  {/* Diff collapse (adjust turns) sits above the final-JSON collapse, per the original. */}
                  {m.diff && (
                    <AdjustDiffCollapse
                      kind={m.diff.kind}
                      text={m.diff.text}
                      lineNumbers={settings.io.jsonViewerLineNumbers}
                      highlight={settings.io.jsonViewerHighlight}
                    />
                  )}
                  {m.sceneObj && (
                    <SceneJsonCollapse
                      rawJsonString={m.sceneJson || JSON.stringify(m.sceneObj)}
                      format={settings.io.sceneJsonFormat}
                      lineNumbers={settings.io.jsonViewerLineNumbers}
                      highlight={settings.io.jsonViewerHighlight}
                    />
                  )}
                  {/* Post-turn recap (ai.includeTurnSummary), rendered as markdown below the card. */}
                  {m.summary && (
                    <div
                      className="sceneSummaryText markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownToSafeHtml(m.summary) }}
                    />
                  )}
                </div>
              </div>
            );
          })}
          {busy && (
            <div className="chatMessage chatMessageAssistant">
              <div className="chatMessageAvatar chatMessageAvatarAssistant">
                <img src={LOGO_URL} alt="ThreeBox" />
              </div>
              <div className="chatMessageBody">
                <pre className="streamingPreview streamingPreviewPending streamingPreviewProcessing">{stream ? stream.slice(-2000) : L("正在生成…", "Generating…")}</pre>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chatHero" hidden={hasMessages}>
          <div className="chatHeroInner">
            <img src={LOGO_URL} alt="ThreeBox" className="chatHeroLogo" />
            <h1 className="chatHeroTitle">{L("打开盒子，看见世界", "Open the box, see a world")}</h1>
            <p className="chatHeroSubtitle">{L("描述一个世界，看它成为现实。", "Describe a world. Watch it become real.")}</p>
            <div className="chatHeroSuggestions">
              {HERO_SUGGESTIONS.map((s) => (
                <button
                  key={s.en}
                  type="button"
                  className="chatSuggestionChip"
                  onClick={() => {
                    const p = zh ? s.promptZh : s.promptEn;
                    setPrompt(p);
                    composerRef.current?.focus();
                  }}
                >
                  {L(s.zh, s.en)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="chatComposerBar">
          <div
            className={`chatComposer${composerAttach.dragOver ? " dragOver" : ""}`}
            id="chatComposer"
            onDragEnter={composerAttach.handleDragEnter}
            onDragOver={composerAttach.handleDragOver}
            onDragLeave={composerAttach.handleDragLeave}
            onDrop={composerAttach.handleDrop}
          >
            <AttachedContextRow attachedContext={attachedContext} showToast={showToast} sceneCardOptions={sceneCardOptions} />
            {canAdjust && (
              <div className="composerModeRow">
                <label className={`composerModeOpt${isAdjust ? " active" : ""}`}>
                  <input type="radio" name="turnMode" checked={isAdjust} onChange={() => setModeOverride("adjust")} />
                  {L("调整当前场景", "Adjust this scene")}
                </label>
                <label className={`composerModeOpt${!isAdjust ? " active" : ""}`}>
                  <input type="radio" name="turnMode" checked={!isAdjust} onChange={() => setModeOverride("generate")} />
                  {L("生成新场景", "New scene")}
                </label>
              </div>
            )}
            <div className="composerInputRow">
              <button
                type="button"
                className="composerIconBtn"
                title={L("上传文件或图片", "Attach")}
                aria-haspopup="menu"
                aria-expanded={composerAttach.attachMenuOpen}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setAttachMenuPos({ x: Math.round(rect.left), y: Math.round(rect.top) });
                  composerAttach.toggleAttachMenu();
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M10 4v12M4 10h12" />
                </svg>
              </button>
              <input
                ref={composerAttach.fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={composerAttach.handleFileInputChange}
              />
              <textarea
                ref={composerRef}
                className="composerInput"
                rows={1}
                value={prompt}
                placeholder={
                  isAdjust
                    ? L('描述你想要的改动，例如"把盒子改成红色"…', 'Describe the change, e.g. "make the box red"…')
                    : L("描述你想创造的 3D 世界...", "Describe the 3D world you want to create...")
                }
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <div className="composerActions">
                <select
                  className="composerModelSelect"
                  aria-label={L("模型", "Model")}
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                >
                  {providers.length === 0 && <option value="">{L("默认模型", "Default model")}</option>}
                  {providers.map((p) => (
                    <option
                      key={p.id}
                      value={p.id}
                      disabled={p.provider === BUILTIN_PROVIDER_TYPE && !provider.privacyAccepted}
                    >
                      {p.label || p.id}
                    </option>
                  ))}
                </select>
                {busy ? (
                  <button type="button" className="composerSendBtn composerStopBtn" title={L("停止", "Stop")} onClick={() => abortRef.current?.abort()}>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="composerSendBtn"
                    title={L("发送", "Send")}
                    disabled={!prompt.trim()}
                    onClick={() => void send(prompt)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path fill="currentColor" d="M10 3.5 16.5 16h-13L10 3.5z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="composerHint">
            {L("ThreeBox 可能会生成不准确的场景，请检查生成结果。", "ThreeBox may produce inaccurate scenes; please review the result.")}
          </div>
        </div>

      </main>

      {composerAttach.attachMenuOpen && attachMenuPos && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={composerAttach.closeAttachMenu}
          />
          <div
            id="attachTypeMenu"
            className="contextMenu"
            style={{
              position: "fixed",
              left: Math.max(8, attachMenuPos.x),
              // Anchor the menu's bottom just above the attach button.
              bottom: Math.max(8, window.innerHeight - attachMenuPos.y + 8),
              zIndex: 41
            }}
          >
            {ATTACH_KIND_ORDER.map(({ kind, labelKey, fallback }) => (
              <button key={kind} type="button" onClick={() => composerAttach.chooseKind(kind)}>
                {t(labelKey, fallback)}
              </button>
            ))}
            <button type="button" onClick={() => composerAttach.chooseKind("library")}>
              {t("threebox.shell.attachKindLibrary", "从资源库选择")}
            </button>
          </div>
        </>
      )}

      {historyMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setHistoryMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setHistoryMenu(null);
            }}
          />
          <div
            className="contextMenu"
            style={{
              position: "fixed",
              left: Math.min(historyMenu.x, window.innerWidth - 200),
              top: Math.min(historyMenu.y, window.innerHeight - 200),
              zIndex: 41
            }}
          >
            <button
              type="button"
              onClick={() => {
                void togglePin(historyMenu.conv);
                setHistoryMenu(null);
              }}
            >
              {historyMenu.conv.pinned ? L("取消置顶", "Unpin") : L("置顶", "Pin")}
            </button>
            <button
              type="button"
              onClick={() => {
                void toggleArchive(historyMenu.conv);
                setHistoryMenu(null);
              }}
            >
              {historyMenu.conv.archived ? L("取消归档", "Unarchive") : L("归档", "Archive")}
            </button>
            {projects.length > 0 && <div className="contextMenuSubLabel">{L("移入项目", "Move to project")}</div>}
            <div className="contextMenuSubList">
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => {
                    void moveToProject(historyMenu.conv, proj.id);
                    setHistoryMenu(null);
                  }}
                >
                  {proj.name}
                </button>
              ))}
              {historyMenu.conv.projectId && (
                <button
                  type="button"
                  onClick={() => {
                    void moveToProject(historyMenu.conv, null);
                    setHistoryMenu(null);
                  }}
                >
                  {L("移出项目", "Remove from project")}
                </button>
              )}
            </div>
            <button
              type="button"
              className="contextMenuDanger"
              onClick={() => {
                const c = historyMenu.conv;
                setHistoryMenu(null);
                void removeConversation(c);
              }}
            >
              {L("删除", "Delete")}
            </button>
          </div>
        </>
      )}

      {toast && (
        <div className={`messageToast show ${toast.kind}`} role="status">
          {toast.text}
        </div>
      )}

      {showPrivacy && (
        <PrivacyDialog
          deviceId={provider.deviceId}
          onAccept={() => {
            provider.acceptPrivacy();
            setShowPrivacy(false);
            // Now that the agreement is accepted, issue the trial key + quota.
            void ensureBuiltinApiKey(threeBoxSettingsController);
          }}
          onDecline={() => {
            provider.declinePrivacy();
            setShowPrivacy(false);
            openSettings("ai");
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          initialSectionId={settingsSection}
          privacyAccepted={provider.privacyAccepted}
          showToast={showToast}
          onSyncNow={() => selfHostedSync.syncNow()}
          onClose={() => setShowSettings(false)}
          onOpenPrivacy={() => {
            setShowSettings(false);
            setShowPrivacy(true);
          }}
        />
      )}

      {showSearch && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setShowSearch(false)}>
          <div className="modalDialog">
            <div className="modalHeader">{L("搜索聊天", "Search chats")}</div>
            <div className="modalBody">
              <input
                type="search"
                className="sidebarSearchInput"
                placeholder={L("按标题搜索...", "Search by title...")}
                value={searchQuery}
                autoFocus
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="searchChatResults">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="searchChatResult"
                    onClick={() => {
                      setShowSearch(false);
                      void openConversation(c.id);
                    }}
                  >
                    {c.title || L("未命名", "Untitled")}
                  </button>
                ))}
                {searchResults.length === 0 && <div className="historyEmpty">{L("无匹配。", "No matches.")}</div>}
              </div>
            </div>
            <div className="modalFooter">
              <button type="button" onClick={() => setShowSearch(false)}>
                {L("关闭", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setShowHelp(false)}>
          <div className="modalDialog">
            <div className="modalHeader">{L("帮助", "Help")}</div>
            <div className="modalBody">
              <p>{L("遇到问题？欢迎通过以下方式联系我们：", "Having trouble? Reach us via:")}</p>
              <ul className="helpContactList">
                <li>
                  <span>{L("邮箱反馈：", "Email: ")}</span>
                  <a href="mailto:threejson@outlook.com">threejson@outlook.com</a>
                </li>
                <li>
                  <span>{L("或提交 GitHub Issue：", "Or file a GitHub issue: ")}</span>
                  <a href="https://github.com/nnrj/threejson/issues" target="_blank" rel="noreferrer">
                    github.com/nnrj/threejson/issues
                  </a>
                </li>
              </ul>
            </div>
            <div className="modalFooter">
              <button type="button" onClick={() => setShowHelp(false)}>
                {L("关闭", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
