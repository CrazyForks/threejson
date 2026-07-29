/**
 * React lifecycle wrapper around @threejson/player-kit's createPlayerRuntime.
 *
 * The runtime is created once, when the canvas element mounts, and disposed on unmount. Its
 * `onEvent` stream (loading / error / transport-change / title-change / volume-change) is projected
 * into React state so components can render loading masks, transport buttons, and titles
 * declaratively — the imperative methods (load*, play, pause, …) are re-exposed as stable callbacks.
 *
 * Options are read through a "latest ref" rather than being listed as effect dependencies: the
 * runtime owns a WebGL context and a loaded scene, so re-creating it whenever a caller passes a new
 * inline object/callback would tear down and reload the scene on every render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPlayerRuntime } from "@threejson/player-kit/js/createPlayerRuntime.js";

const INITIAL_STATE = {
  loading: false,
  loadingMessage: "",
  error: null,
  playing: false,
  hasScene: false,
  title: "",
  volume: 1,
  muted: false
};

/**
 * @param {object} [options] forwarded to createPlayerRuntime (assetsBase, assetGatewayUrl,
 *   overrideSceneRenderLoop, sysConfig, progressElement), plus an optional `onEvent` that is called
 *   after this hook's own state projection.
 * @returns {object} refs to attach (canvasRef, canvasWrapRef), reactive state, and player methods.
 */
export function useScenePlayer(options = {}) {
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const runtimeRef = useRef(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, setState] = useState(INITIAL_STATE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }
    const {
      // Pulled out so they are not forwarded twice; the rest passes straight through.
      onEvent: _callerOnEvent,
      canvas: _ignoredCanvas,
      canvasWrap: _ignoredCanvasWrap,
      ...runtimeOptions
    } = optionsRef.current;

    // A scene load started by this runtime can still be in flight when the effect is torn down —
    // notably under React 18 StrictMode, which mounts, unmounts, then remounts in development. Its
    // late events must not write into the state of the *replacement* runtime, so they are dropped
    // once this instance is retired.
    let cancelled = false;

    const runtime = createPlayerRuntime({
      ...runtimeOptions,
      canvas: canvasRef.current,
      canvasWrap: canvasWrapRef.current,
      onEvent(type, detail) {
        if (cancelled) {
          return;
        }
        switch (type) {
          case "loading":
            setState((prev) => ({ ...prev, loading: Boolean(detail?.active) }));
            break;
          case "loading-message":
            setState((prev) => ({ ...prev, loadingMessage: detail?.message ?? "" }));
            break;
          case "error":
            setState((prev) => ({ ...prev, error: detail?.error ?? null, loading: false }));
            break;
          case "transport-change":
            setState((prev) => ({
              ...prev,
              playing: Boolean(detail?.playing),
              hasScene: Boolean(detail?.hasScene)
            }));
            break;
          case "title-change":
            setState((prev) => ({ ...prev, title: detail?.label ?? "" }));
            break;
          case "volume-change":
            setState((prev) => ({
              ...prev,
              volume: typeof detail?.volume === "number" ? detail.volume : prev.volume,
              muted: Boolean(detail?.muted)
            }));
            break;
          default:
            break;
        }
        optionsRef.current.onEvent?.(type, detail);
      }
    });

    runtimeRef.current = runtime;
    setReady(true);
    return () => {
      cancelled = true;
      runtime.dispose();
      runtimeRef.current = null;
      setReady(false);
      setState(INITIAL_STATE);
    };
  }, []);

  // Clearing a surfaced error is React-layer state, so it lives here rather than on the runtime.
  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  const call = useCallback((method, ...args) => runtimeRef.current?.[method]?.(...args), []);

  const loadFromUrl = useCallback((url, opts) => call("loadFromUrl", url, opts), [call]);
  const loadFromFile = useCallback((file, opts) => call("loadFromFile", file, opts), [call]);
  const loadFromPayload = useCallback((payload, opts) => call("loadFromPayload", payload, opts), [call]);
  const loadFromArchiveBytes = useCallback((bytes, opts) => call("loadFromArchiveBytes", bytes, opts), [call]);
  const loadNativeThreeJson = useCallback((file) => call("loadNativeThreeJson", file), [call]);
  const play = useCallback(() => call("play"), [call]);
  const pause = useCallback(() => call("pause"), [call]);
  const togglePlayback = useCallback(() => call("togglePlayback"), [call]);
  const stop = useCallback(() => call("stop"), [call]);
  const setVolume = useCallback((value) => call("setVolume", value), [call]);
  const setMuted = useCallback((value) => call("setMuted", value), [call]);
  const toggleMuted = useCallback(() => call("toggleMuted"), [call]);
  const resize = useCallback((width, height) => call("resize", width, height), [call]);
  const fitViewToSceneBounds = useCallback(() => call("fitViewToSceneBounds"), [call]);
  const highlightModelList = useCallback((list, kind) => call("highlightModelList", list, kind), [call]);
  const clearAlarmAndLocateHighlights = useCallback(() => call("clearAlarmAndLocateHighlights"), [call]);
  const getSnapshot = useCallback(() => runtimeRef.current?.getSnapshot?.() ?? null, []);

  return {
    canvasRef,
    canvasWrapRef,
    ready,
    ...state,
    clearError,
    loadFromUrl,
    loadFromFile,
    loadFromPayload,
    loadFromArchiveBytes,
    loadNativeThreeJson,
    play,
    pause,
    togglePlayback,
    stop,
    setVolume,
    setMuted,
    toggleMuted,
    resize,
    fitViewToSceneBounds,
    highlightModelList,
    clearAlarmAndLocateHighlights,
    getSnapshot,
    /** Escape hatch for the rare case an app needs the raw player-kit runtime. */
    getRuntime: () => runtimeRef.current
  };
}
