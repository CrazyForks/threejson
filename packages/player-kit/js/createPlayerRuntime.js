/**
 * Ported from tools/scene-host/player/js/playerApp.js's `bootstrapPlayerApp()` — but unlike
 * @threejson/host-kit (which was already split into ~44 independently-exportable modules),
 * playerApp.js is one 1478-line closure with scene-lifecycle logic, transport state, playlist UI,
 * top-bar wiring, and settings-modal wiring all interleaved directly against specific DOM element
 * IDs. There was no pre-existing "embeddable core vs. full app shell" seam to copy — this module
 * *is* that seam, extracted by hand.
 *
 * In scope (mirrors the plan's explicit "mount / load / dispose / transport / highlight"): scene
 * runtime lifecycle (load from URL/File/payload/.tjz archive, dispose), transport (play/pause),
 * audio volume/mute, highlight (via playerHighlight.js), viewport fit, resize, and the
 * editor-preview/scenePreviewProtocol integration (via playerEditorPreviewBridge.js).
 *
 * Out of scope (stays in tools/scene-host/player and the future apps/scene-player): playlist
 * *array* management + its DOM list/context-menu rendering, top menu bar, settings modal UI,
 * immersive-chrome edge-hover behavior. playerPlaylistIdb.js's raw IndexedDB blob storage primitives
 * are still exported from this package (a future playlist layer needs them either way), but the
 * playlist *business logic* (append/activate/restore/persist-manifest-to-localStorage) that wrapped
 * them in playerApp.js is app-level UI-list-management, not "embed a player" material — matching the
 * plan's own "可选 playlist 内核" (optional) framing.
 *
 * DOM decoupling: this module touches exactly one DOM surface directly — the `canvas` (and
 * `canvasWrap`, for layout sizing) the caller hands it, because rendering fundamentally needs
 * somewhere to render to. Everything else (loading text, transport button state, scene title) is
 * reported via `onEvent(type, detail)` instead of being written into specific element IDs — the
 * original's `showMessage`/`setLoadingMessage`/`syncTransportBar`/`updatePlayerTopBarSceneTitle`
 * equivalents. See the `onEvent` types listed below.
 */
import "threejson/builtins/register";
import {
  bindProgressElement,
  bindThreeJsonSceneAudioUnlock,
  buildAdaptiveContentBoundingBoxTHREE,
  buildMinimalWorldJsonForNativeThreeInline,
  createJsonScene,
  createJsonSceneFromArchive,
  disposeTrackedResources,
  ensureThreeJsonIdsOnScenePayload,
  ensureThreeJsonAudioListener,
  fitPerspectiveCameraToContentBoundsTHREE,
  isLoadableScenePayload,
  openOrCloseProgressManager,
  resolveScenePayloadForLoad,
  resumeThreeJsonAudioContextFromCamera,
  setThreeJsonSceneAudioPaused,
  setThreeJsonSceneAudioPlaybackPolicy,
  teardownThreeJsonSceneAudioFromRuntime,
  trackDisposableResource
} from "threejson/player";
import { createPlayerSysConfig } from "@threejson/host-kit/js/createPlayerSysConfig.js";
import { buildPlayerScenePayload } from "@threejson/host-kit/js/buildPlayerRuntimeConfig.js";
import { sceneHostAssetUrl, resolveSceneHostUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { createPlayerHighlightController, getPlayerHighlightChannelOptions } from "./playerHighlight.js";
import { createPlayerSceneInteraction } from "./playerSceneInteraction.js";

function fileNameFromUrl(url = "") {
  try {
    const path = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost").pathname;
    const base = path.split("/").pop() || "";
    return decodeURIComponent(base) || url;
  } catch {
    const parts = String(url || "").split(/[/\\]/);
    return parts[parts.length - 1] || String(url || "");
  }
}

export function isTjzSceneFileName(name = "") {
  return /\.tjz$/i.test(String(name || "").trim());
}
export function isJsonSceneFileName(name = "") {
  return /\.(json|threejson|tjson)$/i.test(String(name || "").trim());
}
export function isSupportedSceneFileName(name = "") {
  return isTjzSceneFileName(name) || isJsonSceneFileName(name);
}

/**
 * `onEvent(type, detail)` types:
 * - "loading" { active: boolean }
 * - "loading-message" { message: string }
 * - "loaded" { label: string }
 * - "error" { error: Error, phase: "load"|"archive"|"native" }
 * - "transport-change" { hasScene: boolean, playing: boolean }
 * - "title-change" { label: string }
 * - "volume-change" { volume: number, muted: boolean }
 */
export function createPlayerRuntime({
  canvas,
  canvasWrap = null,
  sysConfig = createPlayerSysConfig(),
  assetsBase = sceneHostAssetUrl("assets/"),
  assetGatewayUrl = "",
  overrideSceneRenderLoop = false,
  progressElement = null,
  onEvent = null
} = {}) {
  if (!canvas) {
    throw new Error("createPlayerRuntime: canvas is required");
  }
  if (progressElement) {
    bindProgressElement(progressElement);
  }

  let scene = null;
  let camera = null;
  let renderer = null;
  let controls = null;
  let renderLoop = null;
  let sceneRuntime = null;
  let currentLabel = "";
  let loadedSceneJsonText = "";
  let playbackRenderPaused = false;
  let volume = 1;
  let muted = false;
  let busy = false;
  let previewBindSceneEventsOverride;

  const playerHighlight = createPlayerHighlightController();
  const playerSceneInteraction = createPlayerSceneInteraction({
    getScene: () => scene,
    getCamera: () => camera,
    getCanvas: () => renderer?.domElement ?? canvas,
    getSysConfig: () => sysConfig,
    getSelectionVisual: () => playerHighlight.getSelectionVisual()
  });

  function emit(type, detail) {
    onEvent?.(type, detail);
  }

  function emitTransportChange() {
    emit("transport-change", { hasScene: Boolean(renderLoop), playing: Boolean(renderLoop?.isRunning?.()) && !playbackRenderPaused });
  }

  function primeCanvasLayout() {
    const w = canvasWrap?.clientWidth || canvas?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 0);
    const h = canvasWrap?.clientHeight || canvas?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 0);
    if (w > 0 && h > 0) {
      sysConfig.canvasWidth = w;
      sysConfig.canvasHeight = h;
      sysConfig.windowSizeNow.width = w;
      sysConfig.windowSizeNow.height = h;
    }
  }

  /** Yields two animation frames so CSS layout has settled before the canvas is measured — but
   * bounded by a timer, because `requestAnimationFrame` does not fire at all while the document is
   * hidden (background tab, display:none container, an embedding panel that is not composited).
   * The original tools/scene-host player awaited the bare double-rAF, which means a load started
   * while hidden never resolves; for an embeddable runtime that would be a permanent hang, so the
   * timeout lets the load proceed with the element's current (or fallback) size and lets the live
   * resize handling correct it once the page becomes visible. */
  function waitTwoFramesOrTimeout(timeoutMs = 120) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      }
    });
  }

  async function waitCanvasLayout() {
    primeCanvasLayout();
    await waitTwoFramesOrTimeout();
    primeCanvasLayout();
  }

  function assignRuntime(runtime) {
    if (!runtime || typeof runtime !== "object") {
      return;
    }
    sceneRuntime = runtime;
    scene = runtime.scene ?? scene;
    camera = runtime.camera ?? camera;
    renderer = runtime.renderer ?? renderer;
    controls = runtime.controls ?? controls;
    renderLoop = runtime.renderLoop ?? renderLoop;
  }

  function resetInitFlags() {
    for (const key of Object.keys(sysConfig.initFlags)) {
      sysConfig.initFlags[key] = false;
    }
  }

  function markSceneLoaded() {
    for (const key of Object.keys(sysConfig.initFlags)) {
      if (key !== "highLightInitFlag") {
        sysConfig.initFlags[key] = true;
      }
    }
  }

  function applyMasterVolume() {
    setThreeJsonSceneAudioPlaybackPolicy({ paused: muted, masterVolume: muted ? 0 : volume });
    if (!camera) {
      return;
    }
    const listener = ensureThreeJsonAudioListener(camera);
    if (listener && typeof listener.setMasterVolume === "function") {
      listener.setMasterVolume(muted ? 0 : volume);
    }
  }

  function clearCanvasSurface() {
    try {
      if (renderer && canvas && typeof renderer.getContext === "function") {
        const gl = renderer.getContext();
        if (gl) {
          gl.clearColor(47 / 255, 47 / 255, 47 / 255, 1);
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        }
      }
    } catch {
      /* WebGL context may already be lost — ignore */
    }
    try {
      if (canvas) {
        const w = canvas.width;
        canvas.width = w;
      }
    } catch {
      /* ignore */
    }
  }

  function handleCanvasContextMenu(event) {
    event.preventDefault();
    sysConfig.rightClickedFlag = true;
  }

  function teardownScene() {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleWindowResize);
    }
    canvas?.removeEventListener("contextmenu", handleCanvasContextMenu);
    renderLoop?.stop?.();
    renderLoop?.setComposer?.(null);
    playerHighlight.dispose();
    playerSceneInteraction.disposeHostedDoorDblclick();
    try {
      teardownThreeJsonSceneAudioFromRuntime(sceneRuntime);
    } catch {
      /* ignore */
    }
    try {
      disposeTrackedResources();
    } catch (error) {
      console.warn("[player-kit] dispose", error);
    }
    try {
      sceneRuntime?.dispose?.();
    } catch {
      /* ignore */
    }
    clearCanvasSurface();
    scene = null;
    camera = null;
    renderer = null;
    controls = null;
    sceneRuntime = null;
    renderLoop = null;
    resetInitFlags();
    sysConfig.meshObjects = [];
    playbackRenderPaused = false;
  }

  function initHighlight() {
    const ok = playerHighlight.init({
      scene,
      camera,
      renderer,
      renderLoop,
      canvas,
      channelOptions: getPlayerHighlightChannelOptions(null),
      onDoubleClickObject: (obj) => playerSceneInteraction.handleObjectDoubleClick(obj)
    });
    if (ok) {
      sysConfig.initFlags.highLightInitFlag = true;
      playerSceneInteraction.attachHostedDoorDblclick();
      if (playbackRenderPaused) {
        renderLoop?.stop?.();
      } else {
        renderLoop?.start?.();
      }
    }
  }

  function superAnimate() {
    if (!renderLoop) {
      return;
    }
    renderLoop.setComposer(playerHighlight.getComposer?.() ?? null);
    if (playbackRenderPaused) {
      renderLoop.stop();
    } else {
      renderLoop.start();
    }
    emitTransportChange();
  }

  function resize(width, height) {
    const w = Math.max(80, width ?? (canvasWrap?.clientWidth || canvas?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 0)));
    const h = Math.max(80, height ?? (canvasWrap?.clientHeight || canvas?.clientHeight || (typeof window !== "undefined" ? window.innerHeight : 0)));
    sysConfig.windowSizeNow.width = w;
    sysConfig.windowSizeNow.height = h;
    sysConfig.canvasWidth = w;
    sysConfig.canvasHeight = h;
    renderLoop?.resize({ width: w, height: h });
  }

  // A single stable reference (ignores the Event arg the browser passes) so
  // window.removeEventListener("resize", handleWindowResize) in teardownScene/dispose actually
  // matches what was added — passing a fresh arrow function to addEventListener each load would
  // make every removeEventListener call a silent no-op, leaking a listener per scene load.
  function handleWindowResize() {
    resize();
  }

  function buildCreateJsonSceneOptions() {
    const opts = {
      canvas,
      assetsBase,
      assetGateway: assetGatewayUrl ? { baseUrl: assetGatewayUrl } : undefined,
      autoFillLights: true,
      autoFillCamera: true,
      sceneAutoRotate: sysConfig.sceneAutoRotate,
      renderLoopUserPolicy: {
        fps: sysConfig.fps,
        lowFps: sysConfig.lowFps,
        overrideSceneRenderLoop: overrideSceneRenderLoop === true
      },
      async onRuntimeReady(ctx) {
        assignRuntime(ctx?.runtime);
        resize();
        superAnimate();
      },
      async onSceneReady(ctx) {
        try {
          const { bootstrapFirstPersonExtensionsFromScene } = await import(
            "threejson/extensions/fps-walk/bootstrapFirstPersonExtensions.js"
          );
          await bootstrapFirstPersonExtensionsFromScene(ctx);
        } catch (err) {
          console.warn("[player-kit] firstPerson bootstrap skipped", err);
        }
      }
    };
    if (previewBindSceneEventsOverride !== undefined) {
      opts.bindSceneEvents = previewBindSceneEventsOverride;
    }
    return opts;
  }

  async function initSceneRuntime() {
    await waitCanvasLayout();
    const payload = buildPlayerScenePayload(sysConfig, { render: { overrideSceneRenderLoop } });
    sceneRuntime = await createJsonScene(payload, buildCreateJsonSceneOptions());
    assignRuntime(sceneRuntime);
    const normalized = sceneRuntime?.normalizedPayload;
    if (normalized && typeof normalized === "object") {
      sysConfig.jsonData = normalized;
    }
    markSceneLoaded();
    trackDisposableResource(scene);
    resize();
    bindThreeJsonSceneAudioUnlock(canvas, () => sceneRuntime);
    applyMasterVolume();
    void resumeThreeJsonAudioContextFromCamera(camera);
    if (sceneRuntime) {
      setThreeJsonSceneAudioPaused(sceneRuntime, muted);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("resize", handleWindowResize);
    }
    canvas?.addEventListener("contextmenu", handleCanvasContextMenu);
    initHighlight();
    superAnimate();
  }

  function fitViewToSceneBounds() {
    if (!camera || !controls || !scene) {
      return false;
    }
    const bounds = buildAdaptiveContentBoundingBoxTHREE(scene, { ignoreHelper: null });
    if (!bounds) {
      return false;
    }
    return fitPerspectiveCameraToContentBoundsTHREE(camera, controls, bounds, {
      aspectHints: {
        rendererDomElement: renderer?.domElement,
        threeViewActive: false,
        mainViewRect: { x: 0, y: 0, width: sysConfig.canvasWidth, height: sysConfig.canvasHeight },
        canvasWrap: canvasWrap || canvas
      }
    });
  }

  function scheduleSceneFitPasses() {
    fitViewToSceneBounds();
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => fitViewToSceneBounds()));
      window.setTimeout(() => fitViewToSceneBounds(), 1200);
    }
  }

  function finishSceneLoad() {
    emit("loading-message", { message: "" });
    emit("loading", { active: false });
    openOrCloseProgressManager(false);
    scheduleSceneFitPasses();
    emitTransportChange();
  }

  async function loadFromPayload(data, { label: hintLabel = "", bindSceneEvents } = {}) {
    if (busy) return false;
    busy = true;
    previewBindSceneEventsOverride = bindSceneEvents;
    try {
      const payload = resolveScenePayloadForLoad(data, { label: hintLabel });
      if (!isLoadableScenePayload(payload)) {
        throw new Error("Invalid JSON format; worldInfo or a standard objectList is required.");
      }
      ensureThreeJsonIdsOnScenePayload(payload);
      loadedSceneJsonText = JSON.stringify(payload, null, 2);
      teardownScene();
      sysConfig.jsonData = payload;
      emit("loading", { active: true });
      emit("loading-message", { message: "Loading scene JSON..." });
      openOrCloseProgressManager(sysConfig.progressFlag);
      await initSceneRuntime();
      currentLabel = String(payload?.label || payload?.name || hintLabel || "").trim() || fileNameFromUrl(hintLabel) || "Untitled Scene";
      emit("title-change", { label: currentLabel });
      finishSceneLoad();
      return true;
    } catch (error) {
      emit("loading", { active: false });
      openOrCloseProgressManager(false);
      emit("error", { error, phase: "load" });
      return false;
    } finally {
      previewBindSceneEventsOverride = undefined;
      busy = false;
    }
  }

  async function loadFromArchiveBytes(bytes, { label: hintLabel = "" } = {}) {
    if (busy) return false;
    busy = true;
    try {
      teardownScene();
      await waitCanvasLayout();
      emit("loading", { active: true });
      emit("loading-message", { message: "Extracting .tjz scene..." });
      openOrCloseProgressManager(sysConfig.progressFlag);
      const loadedRuntime = await createJsonSceneFromArchive(bytes, buildCreateJsonSceneOptions());
      assignRuntime(loadedRuntime);
      const normalized = loadedRuntime?.normalizedPayload;
      if (normalized && typeof normalized === "object") {
        sysConfig.jsonData = normalized;
        loadedSceneJsonText = JSON.stringify(normalized, null, 2);
      }
      markSceneLoaded();
      trackDisposableResource(scene);
      resize();
      bindThreeJsonSceneAudioUnlock(canvas, () => sceneRuntime);
      applyMasterVolume();
      void resumeThreeJsonAudioContextFromCamera(camera);
      if (sceneRuntime) {
        setThreeJsonSceneAudioPaused(sceneRuntime, muted);
      }
      if (typeof window !== "undefined") {
        window.addEventListener("resize", handleWindowResize);
      }
      canvas?.addEventListener("contextmenu", handleCanvasContextMenu);
      initHighlight();
      superAnimate();
      currentLabel = String(hintLabel || "").trim() || ".tjz Scene";
      emit("title-change", { label: currentLabel });
      finishSceneLoad();
      return true;
    } catch (error) {
      emit("loading", { active: false });
      openOrCloseProgressManager(false);
      emit("error", { error, phase: "archive" });
      return false;
    } finally {
      busy = false;
    }
  }

  async function loadFromUrl(url, { label } = {}) {
    const resolvedUrl = resolveSceneHostUrl(url);
    emit("loading", { active: true });
    emit("loading-message", { message: "Reading scene..." });
    openOrCloseProgressManager(sysConfig.progressFlag);
    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      const error = new Error(`Failed to load scene: ${response.status}`);
      emit("loading", { active: false });
      emit("error", { error, phase: "load" });
      return false;
    }
    if (isTjzSceneFileName(resolvedUrl)) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return loadFromArchiveBytes(bytes, { label: label || fileNameFromUrl(resolvedUrl) });
    }
    const data = JSON.parse(await response.text());
    return loadFromPayload(data, { label: label || fileNameFromUrl(resolvedUrl) });
  }

  async function loadFromFile(file, { label } = {}) {
    if (!file) return false;
    if (isTjzSceneFileName(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return loadFromArchiveBytes(bytes, { label: label || file.name });
    }
    const rawText = await file.text();
    const data = JSON.parse(rawText);
    return loadFromPayload(data, { label: label || file.name });
  }

  async function loadNativeThreeJson(file) {
    if (!file || busy) return false;
    busy = true;
    try {
      emit("loading", { active: true });
      emit("loading-message", { message: "Reading native Three JSON..." });
      openOrCloseProgressManager(sysConfig.progressFlag);
      const text = await file.text();
      const parsed = JSON.parse(text);
      const wrapped = buildMinimalWorldJsonForNativeThreeInline(parsed, { label: file.name });
      busy = false;
      return await loadFromPayload(wrapped, { label: file.name });
    } catch (error) {
      emit("loading", { active: false });
      openOrCloseProgressManager(false);
      emit("error", { error, phase: "native" });
      busy = false;
      return false;
    }
  }

  function stop() {
    emit("loading", { active: false });
    openOrCloseProgressManager(false);
    teardownScene();
    loadedSceneJsonText = "";
    currentLabel = "";
    sysConfig.jsonData = null;
    playbackRenderPaused = false;
    emit("title-change", { label: "" });
    emitTransportChange();
  }

  function dispose() {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleWindowResize);
    }
    teardownScene();
  }

  function play() {
    if (!renderLoop) return;
    playbackRenderPaused = false;
    renderLoop.start();
    if (sceneRuntime && !muted) {
      setThreeJsonSceneAudioPaused(sceneRuntime, false);
    }
    emitTransportChange();
  }

  function pause() {
    if (!renderLoop) return;
    playbackRenderPaused = true;
    renderLoop.stop();
    if (sceneRuntime) {
      setThreeJsonSceneAudioPaused(sceneRuntime, true);
    }
    emitTransportChange();
  }

  function togglePlayback() {
    if (!renderLoop) return;
    if (renderLoop.isRunning?.()) {
      pause();
    } else {
      play();
    }
  }

  function isPlaying() {
    return Boolean(renderLoop?.isRunning?.()) && !playbackRenderPaused;
  }

  function setVolume(next) {
    const n = Number(next);
    volume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : volume;
    if (volume > 0 && muted) {
      muted = false;
    }
    applyMasterVolume();
    if (sceneRuntime) {
      setThreeJsonSceneAudioPaused(sceneRuntime, muted);
    }
    emit("volume-change", { volume, muted });
  }

  function setMuted(next) {
    muted = Boolean(next);
    applyMasterVolume();
    if (sceneRuntime) {
      setThreeJsonSceneAudioPaused(sceneRuntime, muted);
    }
    emit("volume-change", { volume, muted });
  }

  function toggleMuted() {
    setMuted(!muted);
  }

  function highlightModelList(modelList, lightType = "info") {
    playerHighlight.highlightModelList(modelList, lightType);
  }

  function clearAlarmAndLocateHighlights() {
    playerHighlight.clearAlarmAndLocateHighlights();
  }

  function getSnapshot() {
    return {
      scene,
      camera,
      renderer,
      controls,
      sceneRuntime,
      sysConfig,
      currentLabel,
      loadedSceneJsonText,
      playing: isPlaying(),
      hasScene: Boolean(renderLoop),
      volume,
      muted,
      busy
    };
  }

  return {
    getSysConfig: () => sysConfig,
    getSnapshot,
    loadFromPayload,
    loadFromArchiveBytes,
    loadFromUrl,
    loadFromFile,
    loadNativeThreeJson,
    dispose,
    stop,
    play,
    pause,
    togglePlayback,
    isPlaying,
    setVolume,
    setMuted,
    toggleMuted,
    resize,
    fitViewToSceneBounds,
    highlightModelList,
    clearAlarmAndLocateHighlights,
    getHighlightController: () => playerHighlight,
    getSceneInteraction: () => playerSceneInteraction
  };
}
