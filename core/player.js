/** APIs required by a scene player host, without AI/editor/aggregate exports. */
export {
  createJsonScene,
  createJsonSceneFromArchive
} from "./handler/sceneLoadHandler.js";
export {
  bindProgressElement,
  openOrCloseProgressManager
} from "./cache/loading.js";
export {
  bindThreeJsonSceneAudioUnlock,
  ensureThreeJsonAudioListener,
  resumeThreeJsonAudioContextFromCamera,
  setThreeJsonSceneAudioPaused,
  setThreeJsonSceneAudioPlaybackPolicy,
  teardownThreeJsonSceneAudioFromRuntime
} from "./builder/audioBuilder.js";
export {
  buildMinimalWorldJsonForNativeThreeInline,
  resolveScenePayloadForLoad
} from "./builder/nativeObjectLoader.js";
export { isLoadableScenePayload } from "./handler/sceneFriendlyNormalizer.js";
export {
  buildAdaptiveContentBoundingBoxTHREE,
  ensureThreeJsonIdsOnScenePayload,
  fitPerspectiveCameraToContentBoundsTHREE
} from "./util/util.js";
export {
  disposeTrackedResources,
  trackDisposableResource
} from "./handler/resourceReclaimer.js";
