/**
 * Authoring-view conversion for scene payloads: friendly ⇄ standard.
 *
 * A ThreeJSON document can be written in two views of the same scene — "standard" (the canonical
 * payload the engine consumes) and "friendly" (the terser authoring shape). Any host that lets a
 * user switch views needs both directions, and both have a trap:
 *
 *  - normalizeScenePayload() returns a *normalisation record* (sourcePayload, compatPayload,
 *    friendlyMap, objectList, …), not a scene document. The canonical payload is its `.payload`
 *    field. Handing the whole record back to a user as "the standard JSON" produces a file that is
 *    an order of magnitude larger and is not a scene document.
 *  - buildFriendlyScenePayloadFromCanonical() needs the original source, the canonical payload, and
 *    the friendlyMap — which may live at the document root or under worldInfo depending on how the
 *    document was authored. Miss it and the friendly output loses the author's names.
 *
 * Both functions clone their input, so converting never mutates the caller's object.
 */
import {
  buildFriendlyScenePayloadFromCanonical,
  normalizeScenePayload
} from "threejson";

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value || {})
    : JSON.parse(JSON.stringify(value || {}));
}

/** Pull the friendlyMap from either of the two places a document may carry it. */
export function resolveFriendlyMap(source) {
  if (source?.friendlyMap && typeof source.friendlyMap === "object") {
    return source.friendlyMap;
  }
  if (source?.worldInfo?.friendlyMap && typeof source.worldInfo.friendlyMap === "object") {
    return source.worldInfo.friendlyMap;
  }
  return undefined;
}

/** @returns the canonical scene payload — a loadable scene document, not the normalisation record. */
export function toStandardScenePayload(json) {
  return normalizeScenePayload(clone(json)).payload;
}

/** @returns the same scene in the friendly authoring view, preserving author-supplied names. */
export function toFriendlyScenePayload(json) {
  const source = clone(json);
  const normalized = normalizeScenePayload(source);
  return buildFriendlyScenePayloadFromCanonical(source, normalized.payload, {
    friendlyMap: resolveFriendlyMap(source)
  });
}
