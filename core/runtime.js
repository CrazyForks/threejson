/**
 * Minimal scene-consumer entry.
 *
 * Use this for loading/rendering JSON scenes without importing the aggregate
 * AI, editor, archive, and low-level authoring API surface from `threejson/core`.
 * Optional scene capabilities are resolved lazily by the runtime.
 */
export {
  CREATE_JSON_SCENE_FIT_DEFAULTS,
  createJsonScene,
  createJsonSceneFit,
  createJsonSceneFromArchive,
  createJsonSceneFromInput,
  createJsonSceneFromInputFit,
  createJsonSceneFromObjectRecord,
  createJsonSceneSimple,
  deployJsonScene,
  deployJsonSceneFromArchive,
  deployJsonSceneSimple,
  deployObjectRecordIntoRuntime,
  inspectJsonSceneArchiveEntry,
  isObjectRecordEntry
} from "./handler/sceneLoadHandler.js";

export {
  ensureCsgBrushOpsForPayload,
  isCsgBrushOpsLoaded,
  loadCsgBrushOps,
  scenePayloadNeedsCsg
} from "./handler/csgCapability.js";

export {
  getAssetsBaseMode,
  getAssetsBaseUrl,
  setAssetsBaseMode,
  setAssetsBaseUrl
} from "./util/assetsBase.js";
