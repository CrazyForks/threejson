/**
 * Cheap scene-document shape predicates for hosts that must inspect JSON before
 * opting into the full normalizer/runtime dependency graph.
 */
export function isCanonicalScenePayload(payload = {}) {
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(payload, key);
  return Array.isArray(payload?.objectList)
    && !hasOwn("sceneConfig")
    && !hasOwn("worldInfo")
    && !hasOwn("friendlyMap")
    && !hasOwn("modelList");
}
