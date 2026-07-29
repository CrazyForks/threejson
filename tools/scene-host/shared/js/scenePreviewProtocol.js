/**
 * Explicit postMessage protocol between the legacy scene-host editor and player.
 *
 * This module deliberately has its own origin policy. React apps maintain an independent policy
 * under apps/* so neither product line reaches into the other's source tree while the legacy host
 * remains the deployment-validation baseline.
 */

export const SCENE_PREVIEW_CHANNEL = "threejson:scene-preview";
export const SCENE_PREVIEW_VERSION = 1;

const PRODUCTION_APPLICATION_ORIGINS = Object.freeze([
  "https://threejson.org",
  "https://threebox.org",
  "https://cloud.threebox.org",
  "https://editor.threejson.org",
  "https://player.threejson.org",
  "https://shower.threejson.org"
]);

// These are intentionally explicit development endpoints, not an implicit current-page fallback.
// The legacy host is commonly served from the repository root by a static server on port 8080.
const DEVELOPMENT_APPLICATION_ORIGINS = Object.freeze([
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5180",
  "http://localhost:5181",
  "http://localhost:5182",
  "http://localhost:5183"
]);

/** All browser origins this legacy protocol may exchange messages with. */
export const SCENE_PREVIEW_ALLOWED_ORIGINS = Object.freeze([
  ...PRODUCTION_APPLICATION_ORIGINS,
  ...DEVELOPMENT_APPLICATION_ORIGINS
]);

function isOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

/**
 * @param {string} origin
 * @param {readonly string[]} [allowedOrigins]
 * @returns {boolean}
 */
export function isScenePreviewAllowedOrigin(origin, allowedOrigins = SCENE_PREVIEW_ALLOWED_ORIGINS) {
  return isOrigin(origin) && Array.isArray(allowedOrigins) && allowedOrigins.includes(origin);
}

/**
 * Resolve a peer URL to an allowlisted origin. The caller must still pass that origin explicitly
 * to `postScenePreviewMessage`; there is intentionally no `window.location.origin` default.
 *
 * @param {string|URL} urlLike
 * @param {string} [base]
 * @param {readonly string[]} [allowedOrigins]
 * @returns {string|null}
 */
export function resolveScenePreviewPeerOrigin(
  urlLike,
  base = typeof window !== "undefined" ? window.location.href : undefined,
  allowedOrigins = SCENE_PREVIEW_ALLOWED_ORIGINS
) {
  try {
    const origin = new URL(urlLike, base).origin;
    return isScenePreviewAllowedOrigin(origin, allowedOrigins) ? origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {MessageEvent} event
 * @param {readonly string[]} [allowedOrigins]
 * @returns {boolean}
 */
export function isScenePreviewMessageEvent(event, allowedOrigins = SCENE_PREVIEW_ALLOWED_ORIGINS) {
  if (!event || typeof event.data !== "object" || event.data === null) {
    return false;
  }
  if (!isScenePreviewAllowedOrigin(event.origin, allowedOrigins)) {
    return false;
  }
  const data = event.data;
  return data.channel === SCENE_PREVIEW_CHANNEL && data.version === SCENE_PREVIEW_VERSION;
}

/**
 * @param {object} data
 * @returns {boolean}
 */
export function isScenePreviewMessage(data) {
  return Boolean(
    data &&
      typeof data === "object" &&
      data.channel === SCENE_PREVIEW_CHANNEL &&
      data.version === SCENE_PREVIEW_VERSION
  );
}

/**
 * @param {Window|null|undefined} target
 * @param {object} message
 * @param {string} targetOrigin Explicit, allowlisted peer origin.
 * @param {readonly string[]} [allowedOrigins]
 */
export function postScenePreviewMessage(
  target,
  message,
  targetOrigin,
  allowedOrigins = SCENE_PREVIEW_ALLOWED_ORIGINS
) {
  if (!target || target.closed || !isScenePreviewAllowedOrigin(targetOrigin, allowedOrigins)) {
    return false;
  }
  target.postMessage(
    {
      channel: SCENE_PREVIEW_CHANNEL,
      version: SCENE_PREVIEW_VERSION,
      ...message
    },
    targetOrigin
  );
  return true;
}

/**
 * Read the explicit opener origin carried by a preview popup URL. This is not a trust decision by
 * itself; the receiver also verifies `event.origin` and `event.source` for every payload.
 */
export function resolveScenePreviewOpenerOrigin(locationLike = window.location) {
  const params = new URLSearchParams(locationLike.search || "");
  const origin = params.get("openerOrigin") || "";
  return isScenePreviewAllowedOrigin(origin) ? origin : null;
}

export function isEditorPreviewUrl(locationLike = window.location) {
  const params = new URLSearchParams(locationLike.search || "");
  return params.get("editorPreview") === "1";
}
