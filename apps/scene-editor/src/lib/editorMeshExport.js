/**
 * Ported from tools/scene-host/editor/js/editorObjectExport.js's quick GLB menu actions ("导出 →
 * 3D 模型 → GLB（整场景）/ GLB（选中对象）"). The format catalog and the general scene export live
 * in @threejson/host-kit's meshExport.js (used directly for "整场景" and by MeshExportDialog for
 * "更多格式…"); only the selected-object variant needs anything app-local, since host-kit's
 * `buildMeshExport` doesn't take a target object3D — it wraps `exportMesh`, not `exportMeshObject`.
 */
import { exportMeshObject } from "threejson";
import { downloadBlob, exportSceneMeshToFile } from "@threejson/host-kit/js/meshExport.js";

export async function exportSceneAsGlb(scene, { renderer, fileNameStem = "scene" } = {}) {
  return exportSceneMeshToFile(scene, { format: "glb", renderer, fileNameStem });
}

/** @returns {Promise<{ fileName: string, warnings: string[] }>} */
export async function exportSelectedObjectAsGlb(scene, threeJsonId, { renderer } = {}) {
  const result = await exportMeshObject(scene, threeJsonId, { format: "glb", renderer });
  const payload = result.data instanceof ArrayBuffer ? result.data : String(result.data || "");
  const blob = new Blob([payload], { type: result.mimeType || "application/octet-stream" });
  const fileName = result.fileNameHint || `${threeJsonId}.glb`;
  downloadBlob(blob, fileName);
  const warnings = Array.isArray(result.warnings)
    ? result.warnings.map((entry) => String(entry?.message || entry || "").trim()).filter(Boolean)
    : [];
  return { fileName, warnings };
}
