/**
 * Resolve texture source URL from material JSON slot (read-only, does not write back to POJO).
 * Supports canonical `textureUrl` and the standard friendly `map` string alias.
 */
import { resolveLibTokenToUrl } from "../cache/assetRegistry.js";

const LIB_PREFIX = "lib://";

/**
 * @param {object|null|undefined} materialJson
 * @returns {string|null}
 */
function resolveTextureSource(materialJson) {
  if (!materialJson || typeof materialJson !== "object" || Array.isArray(materialJson)) {
    return null;
  }
  const raw = typeof materialJson.textureUrl === "string"
    ? materialJson.textureUrl
    : materialJson.map;
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed.length) {
    return null;
  }
  if (trimmed.toLowerCase().startsWith(LIB_PREFIX)) {
    const token = trimmed.slice(LIB_PREFIX.length).trim();
    return resolveLibTokenToUrl(token);
  }
  return trimmed;
}

/**
 * @param {object|null|undefined} materialJson
 * @returns {boolean}
 */
function materialJsonHasResolvableTexture(materialJson) {
  return Boolean(resolveTextureSource(materialJson));
}

export { resolveTextureSource, materialJsonHasResolvableTexture, LIB_PREFIX };
