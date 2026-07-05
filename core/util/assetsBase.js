/**
 * Public asset URL base: npm default jsDelivr CDN; monorepo demos override to `/assets`.
 */

/** Pin to published @threejson/assets version used in default CDN URLs. */
export const ASSETS_PACKAGE_VERSION = "1.0.0";

export const DEFAULT_CDN_ASSETS_BASE =
  `https://cdn.jsdelivr.net/npm/@threejson/assets@${ASSETS_PACKAGE_VERSION}`;

export const LOCAL_ASSETS_BASE = "/assets";

let runtimeBase = DEFAULT_CDN_ASSETS_BASE;

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizeAssetsBase(url) {
  if (typeof url !== "string") {
    return "";
  }
  return url.trim().replace(/\/+$/, "");
}

/**
 * @param {string} url
 */
export function setAssetsBaseUrl(url) {
  const normalized = normalizeAssetsBase(url);
  if (!normalized) {
    throw new Error("setAssetsBaseUrl: expected non-empty base URL");
  }
  runtimeBase = normalized;
}

/** @returns {string} */
export function getAssetsBaseUrl() {
  return runtimeBase;
}

/**
 * @param {string} relativePath e.g. `textures/device/cabinet/cabinet_left_door.png`
 * @returns {string}
 */
export function assetUrl(relativePath) {
  const segment = String(relativePath || "").replace(/^\/+/, "");
  if (!segment) {
    return getAssetsBaseUrl();
  }
  return `${getAssetsBaseUrl()}/${segment}`;
}

/**
 * Rewrite legacy `/assets/...` paths against the active base. https/data URLs pass through.
 * @param {string} url
 * @returns {string}
 */
export function resolvePublicAssetUrl(url) {
  if (typeof url !== "string") {
    return "";
  }
  const input = url.trim();
  if (!input) {
    return "";
  }
  if (/^(data:|blob:|https?:\/\/)/i.test(input) || input.startsWith("//")) {
    return input;
  }
  if (input.startsWith("/assets/")) {
    return assetUrl(input.slice("/assets/".length));
  }
  return input;
}

/**
 * @param {object} payload scene JSON
 * @param {object} [options] createJsonScene options
 * @returns {string|null}
 */
export function resolveAssetsBaseFromLoad(payload = {}, options = {}) {
  const sceneConfig =
    payload?.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
  const candidate = options?.assetsBase ?? sceneConfig.assetsBase;
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = normalizeAssetsBase(candidate);
  return normalized || null;
}

/**
 * Apply per-load assets base override; returns restore function.
 * @param {object} payload
 * @param {object} [options]
 * @returns {() => void}
 */
export function applyAssetsBaseForLoad(payload = {}, options = {}) {
  const override = resolveAssetsBaseFromLoad(payload, options);
  if (!override) {
    return () => {};
  }
  const previous = getAssetsBaseUrl();
  setAssetsBaseUrl(override);
  return () => {
    setAssetsBaseUrl(previous);
  };
}
