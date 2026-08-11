/**
 * Pure helpers used by scene hosts while constructing runtime configuration.
 * This entry must stay free of renderer, built-in domain, AI, and editor setup.
 */
export { hasValue, listOr, valueOr } from "./util/value.js";
export { isCanonicalScenePayload } from "./handler/scenePayloadShape.js";
export {
  jsonSpecifiesFpsField,
  normalizeFpsValue,
  resolveRenderLoopFpsPolicy
} from "./util/renderLoopPolicy.js";
