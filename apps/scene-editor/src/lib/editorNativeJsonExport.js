/**
 * Ported from tools/scene-host/editor/js/editorNativeJsonExport.js — exports the live scene as
 * plain Three.js `Object3D.toJSON()` output (not ThreeJSON format), omitting external-file models
 * too heavy to inline. The heavy lifting (`cloneSceneGraphForNativeExport`,
 * `omitExternalFileModelsForNativeExport`, `embedPortableImageUrlsIntoThreeExportJson`,
 * `estimateThreeNativeJsonPayloadChars`, `NATIVE_EXPORT_JSON_CHAR_SOFT_LIMIT`) is core utility
 * code, reached via the bare `threejson` specifier (core/index.js re-exports `util/util.js` and
 * `builder/nativeObjectLoader.js` with `export *`) — no @threejson/* package wraps this narrowly,
 * since only the editor needs it.
 *
 * Simplified from the original: no rename-before-download prompt (the original's
 * `exportFilenameModal`, gated by `io.promptExportFilename`) — this always downloads under an
 * auto-generated name. A real, if smaller, gap; not worth its own modal until something else in
 * the app also needs a generic "rename before download" dialog.
 */
import {
  cloneSceneGraphForNativeExport,
  embedPortableImageUrlsIntoThreeExportJson,
  estimateThreeNativeJsonPayloadChars,
  NATIVE_EXPORT_JSON_CHAR_SOFT_LIMIT,
  omitExternalFileModelsForNativeExport
} from "threejson";
import { downloadBlob } from "@threejson/host-kit/js/meshExport.js";

function formatOmitSummary(omitted) {
  if (!Array.isArray(omitted) || !omitted.length) {
    return "";
  }
  const labels = omitted.slice(0, 5).map((entry) => {
    const base = entry.name || entry.modelPath || "未命名";
    return Number.isFinite(entry.triangleCount) && entry.triangleCount > 0
      ? `${base}（约 ${entry.triangleCount} 面）`
      : base;
  });
  const tail = omitted.length > 5 ? ` 等 ${omitted.length} 项` : "";
  return `${labels.join("、")}${tail}`;
}

/**
 * @param {import("three").Scene} scene
 * @returns {Promise<{ fileName: string, omittedCount: number, omittedSummary: string }>}
 */
export async function exportNativeSceneJson(scene) {
  if (!scene?.isScene) {
    throw new Error("场景未就绪");
  }
  const exportRoot = cloneSceneGraphForNativeExport(scene, []);
  try {
    const omitResult = omitExternalFileModelsForNativeExport(exportRoot);
    const omitted = omitResult.omitted || [];

    let payload;
    try {
      payload = exportRoot.toJSON();
    } catch {
      // A stray non-serialisable userData value can break toJSON(); clearing it and retrying
      // mirrors the original's fallback.
      exportRoot.traverse((obj) => {
        try {
          obj.userData = {};
        } catch {
          /* ignore */
        }
      });
      payload = exportRoot.toJSON();
    }
    embedPortableImageUrlsIntoThreeExportJson(exportRoot, payload);

    const roughChars = estimateThreeNativeJsonPayloadChars(payload);
    if (roughChars > NATIVE_EXPORT_JSON_CHAR_SOFT_LIMIT) {
      throw new Error(
        `导出体积过大（约 ${Math.round(roughChars / 1_000_000)}M 字符），可能仍含大型网格。请用 ThreeJSON 导出保留 modelPath，或减少场景中的外部模型。`
      );
    }
    let exportText;
    try {
      exportText = JSON.stringify(payload);
    } catch (error) {
      if (/invalid string length/i.test(String(error?.message || error))) {
        throw new Error("序列化结果超过浏览器字符串上限。完整场景请使用 ThreeJSON 导出；过重的外部模型已自动跳过。");
      }
      throw error;
    }
    const fileName = `sceneEditor-three-native-${Date.now()}.json`;
    downloadBlob(new Blob([exportText], { type: "application/json" }), fileName);
    return { fileName, omittedCount: omitted.length, omittedSummary: formatOmitSummary(omitted) };
  } finally {
    exportRoot.clear();
  }
}
