/** Scene document normalization/projection without the aggregate core surface. */
export {
  buildFriendlyScenePayloadFromCanonical,
  buildStandardScenePayloadFromCanonical,
  detectScenePayloadViewFormat,
  hasSceneConfigPrimaryRuntime,
  isCanonicalScenePayload,
  isLoadableScenePayload,
  normalizeCanonicalObjectRecord,
  normalizeFriendlyScenePayload,
  normalizeSceneObjType,
  normalizeScenePayload,
  shouldNormalizeAsFriendly
} from "./handler/sceneFriendlyNormalizer.js";
