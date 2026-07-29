/**
 * Third-party mesh export (GLB / GLTF / OBJ / STL / PLY / USDZ) — the format catalog plus the
 * export-and-download plumbing.
 *
 * Extracted because three separate scene-host apps did this identically: the editor
 * (editorObjectExport.js), the shower (main.js), and threebox (threeBoxSceneCard.js) each carried
 * their own copy of the format list, the `exportMesh` → Blob → download dance, and the
 * warnings-collection step. Only the *dialog* differs between them, so only the dialog stays in the
 * app; everything below is shared.
 *
 * The format labels are i18n keys rather than literals so each app renders them through its own
 * catalog — see host-kit's i18n module for `threebox.meshExport.*`.
 */
import { exportMesh } from "threejson";

export const MESH_EXPORT_FORMATS = Object.freeze([
  { value: "glb", labelKey: "threebox.meshExport.formatGlb", fallback: "GLB (recommended)" },
  { value: "gltf", labelKey: "threebox.meshExport.formatGltf", fallback: "GLTF (JSON)" },
  { value: "obj", labelKey: "threebox.meshExport.formatObj", fallback: "OBJ (geometry-focused)" },
  { value: "stl", labelKey: "threebox.meshExport.formatStl", fallback: "STL (3D printing)" },
  { value: "ply", labelKey: "threebox.meshExport.formatPly", fallback: "PLY" },
  { value: "usdz", labelKey: "threebox.meshExport.formatUsdz", fallback: "USDZ (AR)" }
]);

export function isSupportedMeshExportFormat(format) {
  return MESH_EXPORT_FORMATS.some((entry) => entry.value === String(format || "").toLowerCase());
}

/** Triggers a browser download for a Blob, cleaning up the object URL afterwards. */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Exports a Three.js scene (or subtree) to a mesh file and returns the resulting Blob plus any
 * warnings, without downloading it — so a caller can inspect warnings first, or upload instead.
 *
 * @param {import("three").Object3D} scene
 * @param {object} options
 * @param {string} options.format one of MESH_EXPORT_FORMATS
 * @param {import("three").WebGLRenderer} [options.renderer] required by some exporters for textures
 * @param {string} [options.fileNameStem] base name for the downloaded file
 * @param {"scene"|"selection"} [options.scope]
 * @param {"include"|"skip"} [options.externalModelPolicy]
 * @returns {Promise<{ blob: Blob, fileName: string, warnings: string[] }>}
 */
export async function buildMeshExport(scene, {
  format,
  renderer,
  fileNameStem = "scene",
  scope = "scene",
  externalModelPolicy = "include"
} = {}) {
  if (!scene) {
    throw new Error("buildMeshExport: a scene is required.");
  }
  if (!isSupportedMeshExportFormat(format)) {
    throw new Error(`buildMeshExport: unsupported format "${format}".`);
  }

  const result = await exportMesh(scene, {
    format,
    scope,
    externalModelPolicy,
    renderer,
    fileNameStem
  });

  // Binary exporters hand back an ArrayBuffer; text ones a string.
  const payload = result.data instanceof ArrayBuffer ? result.data : String(result.data || "");
  const blob = new Blob([payload], { type: result.mimeType || "application/octet-stream" });
  const fileName = result.fileNameHint || `${fileNameStem}.${result.extension || format}`;
  const warnings = Array.isArray(result.warnings)
    ? result.warnings.map((entry) => String(entry?.message || entry || "").trim()).filter(Boolean)
    : [];

  return { blob, fileName, warnings };
}

/**
 * buildMeshExport + download in one call.
 * @returns {Promise<{ fileName: string, warnings: string[] }>} warnings are returned rather than
 *   shown, so the app decides whether to surface them (a toast, a dialog, or nothing).
 */
export async function exportSceneMeshToFile(scene, options = {}) {
  const { blob, fileName, warnings } = await buildMeshExport(scene, options);
  downloadBlob(blob, fileName);
  return { fileName, warnings };
}
