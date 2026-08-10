/**
 * Ported from tools/scene-host/editor/js/editorTjzExportModal.js's default path — pack the current
 * scene document into a `.tjz` archive (a zip: scene.json + manifest.json + optional assets) and
 * download it. Archive APIs use the public `threejson/archive` subpath so optional `fflate`
 * support does not become an eager dependency of every ordinary `threejson/core` browser scene.
 *
 * Scoped down from the original: only the `assetPolicy: "preserve"` behavior is implemented (asset
 * URLs stay as URLs, nothing is embedded) — matching io.tjzExport.assetPolicy's default. The
 * `tryPack`/`fetchExternalUrls` variant (fetching and embedding every referenced asset) is a real
 * gap, not built this phase; it needs its own asset-discovery pass this app doesn't have yet.
 */
import { packTjzArchive } from "threejson/archive";
import { downloadBlob } from "@threejson/host-kit/js/meshExport.js";

/**
 * @param {object} payload the committed ThreeJSON document
 * @param {{ fileNameStem?: string }} [options]
 */
export async function exportSceneAsTjz(payload, { fileNameStem = "scene" } = {}) {
  if (!payload) {
    throw new Error("没有可导出的场景文档。");
  }
  const blob = await packTjzArchive(payload, {
    manifest: { entry: "scene.json" },
    outputType: "blob"
  });
  const fileName = `${fileNameStem}-${Date.now()}.tjz`;
  downloadBlob(blob, fileName);
  return { fileName };
}
