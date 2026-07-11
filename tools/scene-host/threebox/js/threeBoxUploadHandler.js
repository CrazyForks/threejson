import { sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";
import { t } from "../../shared/i18n/index.js";

const ACCEPT_BY_KIND = {
  json: ".json,.threejson,.tjson,application/json",
  tjz: ".tjz",
  image: "image/*",
  model: ".gltf,.glb,.obj,.fbx",
  other: "*/*"
};

export function acceptForKind(kind) {
  return ACCEPT_BY_KIND[kind] || "*/*";
}

function createOffscreenCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  return canvas;
}

/** Parses an uploaded `.json`/`.threejson` file's text into a scene JSON object, validating it's
 * actually a loadable scene payload (not just arbitrary JSON) before treating it as one. */
async function processJsonFile(file) {
  const { isLoadableScenePayload } = await import("threejson/core");
  const text = await file.text();
  let sceneJson;
  try {
    sceneJson = JSON.parse(text);
  } catch (error) {
    throw new Error(t("threebox.upload.jsonParseFailed", "JSON 解析失败：{error}", { error: error?.message || error }));
  }
  if (!isLoadableScenePayload(sceneJson)) {
    throw new Error(
      t("threebox.upload.notLoadableScene", "不是有效的 ThreeJSON 场景（缺少 worldInfo 或 objectList）。")
    );
  }
  return sceneJson;
}

/** Unpacks a `.tjz` archive via a throwaway offscreen runtime, then re-exports it back to a
 * standard scene JSON object — mirrors threeBoxOrchestrator.js's offscreen-runtime pattern for
 * command execution, reused here purely for its archive-unpack + JSON-export side effect. */
async function processTjzFile(file) {
  const { createJsonSceneFromArchive, sceneToStandardJsonSimple } = await import("threejson/core");
  const runtime = await createJsonSceneFromArchive(file, {
    canvas: createOffscreenCanvas(),
    assetsBase: sceneHostAssetUrl("assets/")
  });
  try {
    return sceneToStandardJsonSimple(runtime.scene, { merge: false });
  } finally {
    runtime.dispose?.();
  }
}

/** Wraps a 3rd-party model file (glTF/OBJ/FBX) as an `externalModel` object record (core's
 * `importMeshBlob`), deploys it into a throwaway offscreen runtime, then re-exports back to a
 * standard scene JSON — after this point it's indistinguishable from any other loaded scene. */
async function processModelFile(file) {
  const { importMeshBlob, createJsonSceneFromObjectRecord, sceneToStandardJsonSimple } = await import("threejson/core");
  const { record } = await importMeshBlob(file, { fileName: file.name });
  const runtime = await createJsonSceneFromObjectRecord(record, {
    canvas: createOffscreenCanvas(),
    assetsBase: sceneHostAssetUrl("assets/")
  });
  try {
    return sceneToStandardJsonSimple(runtime.scene, { merge: false });
  } finally {
    runtime.dispose?.();
  }
}

/**
 * Routes an uploaded file by the composer's chosen attach-kind. `json`/`tjz`/`model` are
 * auto-loadable (return a parsed `sceneJson`); `image`/`other` are cache-only (no `sceneJson`).
 * @param {File} file
 * @param {"json"|"tjz"|"image"|"model"|"other"} kind
 * @returns {Promise<{ kind: string, name: string, sceneJson: object|null, file: File }>}
 */
export async function processUploadedFile(file, kind) {
  if (kind === "json") {
    return { kind, name: file.name, sceneJson: await processJsonFile(file), file };
  }
  if (kind === "tjz") {
    return { kind, name: file.name, sceneJson: await processTjzFile(file), file };
  }
  if (kind === "model") {
    return { kind, name: file.name, sceneJson: await processModelFile(file), file };
  }
  return { kind, name: file.name, sceneJson: null, file };
}
