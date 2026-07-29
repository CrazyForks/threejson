/**
 * Ported from tools/scene-host/threebox/js/threeBoxSceneCard.js (via threebox-cloud's React
 * version) as a React hook. Renders an inline LIVE Three.js canvas per generated/adjusted scene —
 * each card owns its own canvas + runtime, exactly as the original does (this is why there is no
 * shared viewport). Uses the engine (threejson) directly; host-kit only supplies the asset base and
 * i18n. Actions: download JSON / export .tjz / export mesh / open in editor / open in player /
 * refresh / fullscreen.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";
import { sceneHostAssetUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { enqueueThreeBoxSceneLoad } from "./lib/threeBoxSceneLoadQueue.js";
import { syncThreeBoxPreviewAuxiliaryLights } from "./lib/threeBoxPreviewLights.js";
import {
  openThreeBoxMeshExportDialog,
  showThreeBoxMeshExportWarningDialog
} from "./lib/threeBoxMeshExportDialog.js";
import { openSceneInEditor, openSceneInPlayer } from "./sceneBridgeProtocol.js";

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function waitForStableSize(target) {
  const readSize = () => {
    const rect = target?.getBoundingClientRect?.();
    const width = Math.round(rect?.width || target?.clientWidth || 0);
    const height = Math.round(rect?.height || target?.clientHeight || 0);
    return width > 0 && height > 0 ? { width, height } : null;
  };
  const immediate = readSize();
  if (immediate) {
    return Promise.resolve(immediate);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (size) => {
      if (settled) {
        return;
      }
      settled = true;
      ro.disconnect();
      clearTimeout(timeoutId);
      resolve(size);
    };
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const box = entry.contentBoxSize?.[0];
      const width = box ? Math.round(box.inlineSize) : Math.round(entry.contentRect.width);
      const height = box ? Math.round(box.blockSize) : Math.round(entry.contentRect.height);
      if (width > 0 && height > 0) {
        finish({ width, height });
      }
    });
    if (target) {
      ro.observe(target);
    }
    const timeoutId = window.setTimeout(() => finish(readSize() || { width: 320, height: 180 }), 250);
  });
}

function waitForLoadingMaskPaint() {
  // Gives the loading mask one paint before heavy work begins. requestAnimationFrame does NOT fire
  // while the tab is hidden, so a bare rAF here would hang the whole render on a backgrounded tab —
  // fall back to a short timer so the render always proceeds.
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(finish);
    }
    setTimeout(finish, 80);
  });
}

export function useSceneCard(options = {}) {
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const runtimeRef = useRef(null);
  const liveResizeObserverRef = useRef(null);
  const renderSeqRef = useRef(0);
  const currentSceneJsonRef = useRef(null);
  const currentLabelRef = useRef(t("threebox.sceneCard.defaultLabel", "ThreeBox 场景"));

  const [loadingText, setLoadingText] = useState(t("threebox.sceneCard.waitingForDraft", "等待场景草稿…"));
  const [loadingCompact, setLoadingCompact] = useState(false);
  const [exporting, setExporting] = useState(null);

  const toast = useCallback((msg, kind) => optionsRef.current.showToast?.(msg, kind), []);

  const setLabel = useCallback((label) => {
    const next = String(label || "").trim();
    if (next) {
      currentLabelRef.current = next;
    }
    return currentLabelRef.current;
  }, []);

  const watchLiveResize = useCallback(() => {
    liveResizeObserverRef.current?.disconnect();
    const wrap = canvasWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) {
      return;
    }
    liveResizeObserverRef.current = new ResizeObserver((entries) => {
      if (!runtimeRef.current) {
        return;
      }
      const entry = entries[0];
      const box = entry.contentBoxSize?.[0];
      const width = Math.max(1, Math.round(box ? box.inlineSize : entry.contentRect.width));
      const height = Math.max(1, Math.round(box ? box.blockSize : entry.contentRect.height));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      runtimeRef.current.resize?.({ width, height });
    });
    liveResizeObserverRef.current.observe(wrap);
  }, []);

  const showCompactLoadingProgress = useCallback((deploy = null) => {
    setLoadingCompact(true);
    const done = Number(deploy?.done);
    const total = Number(deploy?.total);
    setLoadingText(
      Number.isFinite(done) && Number.isFinite(total) && total > 0
        ? t("threebox.sceneCard.loadingProgress", "正在装载场景内容 {done}/{total}（不消耗 Token）…", { done, total })
        : t("threebox.sceneCard.loadingContent", "画布已启动，正在装载场景内容（不消耗 Token）…")
    );
  }, []);

  const render = useCallback(
    async (sceneJsonPayload, renderOptions = {}) => {
      const seq = ++renderSeqRef.current;
      liveResizeObserverRef.current?.disconnect();
      liveResizeObserverRef.current = null;
      runtimeRef.current?.dispose?.();
      runtimeRef.current = null;
      currentSceneJsonRef.current = sceneJsonPayload;
      setLabel(
        renderOptions.label ||
          sceneJsonPayload?.label ||
          sceneJsonPayload?.name ||
          t("threebox.sceneCard.defaultLabel", "ThreeBox 场景")
      );
      setLoadingCompact(false);
      setLoadingText(t("threebox.sceneCard.rendering", "场景渲染中（不消耗 Token）…"));

      const { createJsonScene } = await import("threejson");
      const canvas = canvasRef.current;
      const { width, height } = await waitForStableSize(canvasWrapRef.current);
      if (!canvas) {
        return null;
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = width;
      canvas.height = height;
      await waitForLoadingMaskPaint();

      const payload = structuredClone(sceneJsonPayload || {});
      payload.canvasWidth = width;
      payload.canvasHeight = height;
      // An inline embedded card must not follow window resizes regardless of what the scene says.
      payload.sceneConfig = {
        ...payload.sceneConfig,
        renderLoop: { ...payload.sceneConfig?.renderLoop, autoResize: false, firstAutoResize: false }
      };

      let auxiliaryLightsSynced = false;
      const syncAuxiliaryLights = (nextRuntime) => {
        if (auxiliaryLightsSynced || seq !== renderSeqRef.current || !nextRuntime?.scene) {
          return;
        }
        const enabled =
          typeof optionsRef.current.shouldUsePreviewAuxiliaryLights === "function"
            ? optionsRef.current.shouldUsePreviewAuxiliaryLights() !== false
            : optionsRef.current.previewAuxiliaryLights !== false;
        syncThreeBoxPreviewAuxiliaryLights(nextRuntime.scene, enabled);
        auxiliaryLightsSynced = true;
      };
      const activateRuntime = (nextRuntime) => {
        if (!nextRuntime || seq !== renderSeqRef.current) {
          return false;
        }
        if (runtimeRef.current !== nextRuntime) {
          runtimeRef.current = nextRuntime;
          runtimeRef.current.start?.();
          watchLiveResize();
        }
        runtimeRef.current.resize?.({ width, height });
        showCompactLoadingProgress();
        return true;
      };

      try {
        const nextRuntime = await enqueueThreeBoxSceneLoad(() =>
          createJsonScene(payload, {
            canvas,
            resetScene: true,
            assetsBase: sceneHostAssetUrl("assets/"),
            autoFillLights: true,
            autoFillCamera: true,
            autoFitCamera: true,
            onRuntimeReady: ({ runtime: readyRuntime }) => activateRuntime(readyRuntime),
            onDeployProgress: ({ runtime: deployingRuntime, deploy }) => {
              if (seq !== renderSeqRef.current) {
                return;
              }
              syncAuxiliaryLights(deployingRuntime);
              showCompactLoadingProgress(deploy);
            },
            onSceneReady: ({ runtime: readyRuntime }) => syncAuxiliaryLights(readyRuntime)
          })
        );
        if (seq !== renderSeqRef.current) {
          nextRuntime?.dispose?.();
          return null;
        }
        activateRuntime(nextRuntime);
        syncAuxiliaryLights(nextRuntime);
      } finally {
        if (seq === renderSeqRef.current) {
          setLoadingText(null);
        }
      }
      return runtimeRef.current;
    },
    [setLabel, showCompactLoadingProgress, watchLiveResize]
  );

  const dispose = useCallback(() => {
    renderSeqRef.current += 1;
    liveResizeObserverRef.current?.disconnect();
    liveResizeObserverRef.current = null;
    runtimeRef.current?.dispose?.();
    runtimeRef.current = null;
  }, []);

  useEffect(() => () => dispose(), [dispose]);

  const requireSceneJson = useCallback(() => {
    if (!currentSceneJsonRef.current) {
      toast(t("threebox.sceneCard.notReady", "场景尚未生成完成。"), "warning");
      return null;
    }
    return currentSceneJsonRef.current;
  }, [toast]);

  const handleDownloadJson = useCallback(() => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    // Honour io.exportJsonIndent (0 = compact); default to 2 when unset.
    const indent = Number.isFinite(optionsRef.current.exportJsonIndent) ? optionsRef.current.exportJsonIndent : 2;
    const blob = new Blob([JSON.stringify(sceneJson, null, indent)], { type: "application/json" });
    downloadBlob(blob, `${currentLabelRef.current}.json`);
  }, [requireSceneJson]);

  const handleExportTjz = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    setExporting("tjz");
    try {
      const { packJsonSceneArchive } = await import("threejson");
      const blob = await packJsonSceneArchive(sceneJson, { outputType: "blob" });
      downloadBlob(blob, `${currentLabelRef.current}.tjz`);
    } catch (error) {
      toast(t("threebox.sceneCard.exportFailed", "导出失败：{error}", { error: error?.message || error }), "error");
    } finally {
      setExporting(null);
    }
  }, [requireSceneJson, toast]);

  const handleExportMesh = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    const format = await openThreeBoxMeshExportDialog();
    if (!format) {
      return;
    }
    if (!runtimeRef.current?.scene?.isScene) {
      toast(t("threebox.sceneCard.modelNotReady", "画布场景尚未渲染完成。"), "warning");
      return;
    }
    setExporting("mesh");
    toast(t("threebox.sceneCard.exportMeshStarted", "正在导出 {format}…", { format: format.toUpperCase() }), "info");
    try {
      const { exportMesh } = await import("threejson");
      const result = await exportMesh(runtimeRef.current.scene, {
        format,
        scope: "scene",
        externalModelPolicy: "include",
        renderer: runtimeRef.current.renderer,
        fileNameStem: currentLabelRef.current
      });
      const payload = result.data instanceof ArrayBuffer ? result.data : String(result.data || "");
      const blob = new Blob([payload], { type: result.mimeType || "application/octet-stream" });
      downloadBlob(blob, result.fileNameHint || `${currentLabelRef.current}.${result.extension || format}`);
      const warnings = Array.isArray(result.warnings)
        ? result.warnings.filter((entry) => String(entry?.message || "").trim())
        : [];
      const showWarn =
        typeof optionsRef.current.shouldShowMeshExportWarnings === "function"
          ? optionsRef.current.shouldShowMeshExportWarnings() !== false
          : optionsRef.current.showMeshExportWarnings !== false;
      if (warnings.length && showWarn) {
        await showThreeBoxMeshExportWarningDialog(warnings);
      } else {
        toast(t("threebox.sceneCard.exportMeshSuccess", "三方模型已导出。"), "success");
      }
    } catch (error) {
      console.error("[threebox] mesh export failed:", error);
      toast(t("threebox.sceneCard.exportMeshFailed", "导出三方模型失败：{error}", { error: error?.message || error }), "error");
    } finally {
      setExporting(null);
    }
  }, [requireSceneJson, toast]);

  const handleOpenEditor = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    try {
      await openSceneInEditor(sceneJson, currentLabelRef.current);
      toast(t("threebox.sceneCard.openInEditorSuccess", "已将场景发送到编辑器。"), "success");
    } catch (error) {
      const message = String(error?.message || error);
      toast(
        t("threebox.sceneCard.openInEditorFailed", "在编辑器内打开失败：{error}", { error: message }),
        "error"
      );
    }
  }, [requireSceneJson, toast]);

  const handleOpenPlayer = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    try {
      await openSceneInPlayer(sceneJson, currentLabelRef.current);
      toast(t("threebox.sceneCard.openInPlayerSuccess", "已将场景发送到播放器。"), "success");
    } catch (error) {
      const message = String(error?.message || error);
      toast(
        t("threebox.sceneCard.openInPlayerFailed", "在播放器内打开失败：{error}", { error: message }),
        "error"
      );
    }
  }, [requireSceneJson, toast]);

  const handleRefresh = useCallback(async () => {
    const sceneJson = requireSceneJson();
    if (!sceneJson) {
      return;
    }
    setExporting("refresh");
    try {
      await render(sceneJson, { label: currentLabelRef.current });
    } finally {
      setExporting(null);
    }
  }, [requireSceneJson, render]);

  const handleFullscreen = useCallback(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) {
      return;
    }
    if (document.fullscreenElement === wrap) {
      void document.exitFullscreen();
      return;
    }
    wrap.requestFullscreen?.().catch((error) => {
      toast(t("threebox.sceneCard.fullscreenFailed", "进入全屏失败：{error}", { error: error?.message || error }), "warning");
    });
  }, [toast]);

  return {
    canvasRef,
    canvasWrapRef,
    loadingText,
    loadingCompact,
    exporting,
    render,
    dispose,
    getRuntime: () => runtimeRef.current,
    handleDownloadJson,
    handleExportTjz,
    handleExportMesh,
    handleOpenEditor,
    handleOpenPlayer,
    handleRefresh,
    handleFullscreen
  };
}
