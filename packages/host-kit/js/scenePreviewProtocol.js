/** Secure postMessage protocol shared by separately deployed scene-host applications. */

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

export const SCENE_PREVIEW_ALLOWED_ORIGINS = Object.freeze([
  ...PRODUCTION_APPLICATION_ORIGINS,
  ...DEVELOPMENT_APPLICATION_ORIGINS
]);

const configuredOrigins = new Set();

function normalizeOrigin(value, base) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value, base).origin;
  } catch {
    return null;
  }
}

function browserOrigin(locationLike = typeof window !== "undefined" ? window.location : null) {
  return normalizeOrigin(locationLike?.href || locationLike?.origin || "");
}

function uniqueOrigins(values) {
  const origins = new Set();
  for (const value of values || []) {
    const origin = normalizeOrigin(value);
    if (origin) origins.add(origin);
  }
  return Array.from(origins);
}

export function configureScenePreviewAllowedOrigins(origins = []) {
  configuredOrigins.clear();
  for (const origin of uniqueOrigins(origins)) configuredOrigins.add(origin);
  return getScenePreviewAllowedOrigins();
}

export function getScenePreviewAllowedOrigins(
  additionalOrigins = [],
  locationLike = typeof window !== "undefined" ? window.location : null
) {
  return uniqueOrigins([
    ...SCENE_PREVIEW_ALLOWED_ORIGINS,
    ...configuredOrigins,
    browserOrigin(locationLike),
    ...additionalOrigins
  ]);
}

export function isScenePreviewAllowedOrigin(origin, allowedOrigins) {
  const normalized = normalizeOrigin(origin);
  if (!normalized || normalized !== origin) return false;
  const effective = Array.isArray(allowedOrigins)
    ? uniqueOrigins(allowedOrigins)
    : getScenePreviewAllowedOrigins();
  return effective.includes(normalized);
}

export function resolveScenePreviewPeerOrigin(
  urlLike,
  base = typeof window !== "undefined" ? window.location.href : undefined,
  allowedOrigins
) {
  try {
    const origin = new URL(urlLike, base).origin;
    const baseOrigin = normalizeOrigin(base || "");
    const effective = Array.isArray(allowedOrigins)
      ? allowedOrigins
      : getScenePreviewAllowedOrigins(baseOrigin ? [baseOrigin] : []);
    return isScenePreviewAllowedOrigin(origin, effective) ? origin : null;
  } catch {
    return null;
  }
}

export function isScenePreviewMessageEvent(event, allowedOrigins) {
  if (!event || typeof event.data !== "object" || event.data === null) return false;
  return isScenePreviewAllowedOrigin(event.origin, allowedOrigins) && isScenePreviewMessage(event.data);
}

export function isScenePreviewMessage(data) {
  return Boolean(
    data &&
      typeof data === "object" &&
      data.channel === SCENE_PREVIEW_CHANNEL &&
      data.version === SCENE_PREVIEW_VERSION
  );
}

export function postScenePreviewMessage(
  target,
  message,
  targetOrigin = browserOrigin(),
  allowedOrigins
) {
  if (!target || target.closed || !isScenePreviewAllowedOrigin(targetOrigin, allowedOrigins)) return false;
  target.postMessage(
    { channel: SCENE_PREVIEW_CHANNEL, version: SCENE_PREVIEW_VERSION, ...message },
    targetOrigin
  );
  return true;
}

export function resolveScenePreviewOpenerOrigin(
  locationLike = typeof window !== "undefined" ? window.location : { search: "" },
  allowedOrigins,
  referrer = typeof document !== "undefined" ? document.referrer : ""
) {
  const origin = new URLSearchParams(locationLike.search || "").get("openerOrigin") || "";
  const referrerOrigin = normalizeOrigin(referrer);
  const effective = Array.isArray(allowedOrigins)
    ? allowedOrigins
    : getScenePreviewAllowedOrigins(referrerOrigin ? [referrerOrigin] : [], locationLike);
  return isScenePreviewAllowedOrigin(origin, effective) ? origin : null;
}

export function isEditorPreviewUrl(
  locationLike = typeof window !== "undefined" ? window.location : { search: "" }
) {
  return new URLSearchParams(locationLike.search || "").get("editorPreview") === "1";
}
