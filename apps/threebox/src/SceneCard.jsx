/**
 * Faithful port of tools/scene-host/threebox/js/threeBoxSceneCard.js (via threebox-cloud's React
 * version). An inline LIVE Three.js canvas embedded at the end of an AI reply, with an action bar
 * (download JSON / export .tjz / export 3D model / open in editor / open in player / refresh /
 * fullscreen). Each card owns its own canvas + runtime — this is the original architecture, and the
 * reason there is no shared viewport.
 */
import { useEffect } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";
import { useSceneCard } from "./useSceneCard.js";

function ActionBtn({ title, glyph, onClick, disabled }) {
  return (
    <button
      type="button"
      className="sceneCardActionBtn"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      <span dangerouslySetInnerHTML={{ __html: glyph }} />
    </button>
  );
}

/**
 * @param {object} props
 * @param {object|null} props.sceneJson parsed scene payload; a new object triggers a fresh render.
 * @param {string} [props.label]
 * @param {(msg: string, kind?: string) => void} [props.showToast]
 * @param {object} [props.options] scene-card behaviour from settings (previewAuxiliaryLights,
 *   showMeshExportWarnings, exportJsonIndent).
 */
export function SceneCard({ sceneJson, label, showToast, options }) {
  const card = useSceneCard({ showToast, ...options });

  useEffect(() => {
    if (sceneJson) {
      void card.render(sceneJson, { label });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneJson]);

  return (
    <div className="sceneCard">
      <div className="sceneCardCanvasWrap" ref={card.canvasWrapRef}>
        <canvas className="sceneCardCanvas" ref={card.canvasRef} />
        {card.loadingText && (
          <div className={`sceneCardLoadingMask${card.loadingCompact ? " sceneCardLoadingMaskCompact" : ""}`}>
            {card.loadingText}
          </div>
        )}
      </div>
      <div className="sceneCardActionBar">
        <ActionBtn title={t("threebox.sceneCard.downloadJson", "下载 JSON")} glyph="&#8681;" onClick={card.handleDownloadJson} />
        <ActionBtn
          title={t("threebox.sceneCard.exportTjz", "导出 .tjz 场景包")}
          glyph="&#128230;"
          onClick={() => void card.handleExportTjz()}
          disabled={card.exporting === "tjz"}
        />
        <ActionBtn
          title={t("threebox.sceneCard.exportMesh", "导出三方模型")}
          glyph="&#9672;"
          onClick={() => void card.handleExportMesh()}
          disabled={card.exporting === "mesh"}
        />
        <ActionBtn title={t("threebox.sceneCard.openInEditor", "在编辑器内打开")} glyph="&#9998;" onClick={card.handleOpenEditor} />
        <ActionBtn title={t("threebox.sceneCard.openInPlayer", "在播放器内打开")} glyph="&#9654;" onClick={card.handleOpenPlayer} />
        <ActionBtn
          title={t("threebox.sceneCard.refresh", "刷新画布")}
          glyph="&#8635;"
          onClick={() => void card.handleRefresh()}
          disabled={card.exporting === "refresh"}
        />
        <ActionBtn title={t("threebox.sceneCard.fullscreen", "全屏")} glyph="&#10021;" onClick={card.handleFullscreen} />
      </div>
    </div>
  );
}
