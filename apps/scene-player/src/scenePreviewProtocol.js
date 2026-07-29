/**
 * Scene-player's independently configured preview protocol.
 *
 * This intentionally does not import the legacy `tools/scene-host` protocol. The published app can
 * be deployed on a different origin while still using the same small, explicit message contract.
 */

export const SCENE_PREVIEW_CHANNEL = "threejson:scene-preview";
export const SCENE_PREVIEW_VERSION = 1;

const ENV = import.meta.env || {};
const IS_DEVELOPMENT = Boolean(ENV.DEV);

const PRODUCTION_ORIGINS = Object.freeze([
  "https://threejson.org",
  "https://threebox.org",
  "https://cloud.threebox.org",
  "https://editor.threejson.org",
  "https://player.threejson.org",
  "https://shower.threejson.org"
]);

const DEVELOPMENT_ORIGINS = Object.freeze([
  "http://localhost:5180",
  "http://localhost:5181",
  "http://localhost:5182",
  "http://localhost:5183"
]);

function configuredUrl(key, developmentDefault, productionDefault) {
  const fallback = IS_DEVELOPMENT ? developmentDefault : productionDefault;
  const candidate = String(ENV[`VITE_THREEJSON_${key}_URL`] || fallback).trim();
  try {
    return new URL(candidate).href;
  } catch {
    return new URL(fallback).href;
  }
}

export const SCENE_PLAYER_PEER_URLS = Object.freeze({
  editor: configuredUrl("EDITOR", "http://localhost:5183/", "https://editor.threejson.org/"),
  player: configuredUrl("PLAYER", "http://localhost:5180/", "https://player.threejson.org/"),
  shower: configuredUrl("SHOWER", "http://localhost:5181/", "https://shower.threejson.org/"),
  threebox: configuredUrl("THREEBOX", "http://localhost:5182/", "https://threebox.org/")
});

export const SCENE_PLAYER_ALLOWED_ORIGINS = Object.freeze([
  ...new Set([
    ...PRODUCTION_ORIGINS,
    ...DEVELOPMENT_ORIGINS,
    ...Object.values(SCENE_PLAYER_PEER_URLS).map((value) => new URL(value).origin)
  ])
]);

export function isScenePlayerAllowedOrigin(origin) {
  return typeof origin === "string" && SCENE_PLAYER_ALLOWED_ORIGINS.includes(origin);
}

export function isScenePreviewMessageEvent(event) {
  const data = event?.data;
  return Boolean(
    data &&
      typeof data === "object" &&
      isScenePlayerAllowedOrigin(event.origin) &&
      data.channel === SCENE_PREVIEW_CHANNEL &&
      data.version === SCENE_PREVIEW_VERSION
  );
}

export function postScenePreviewMessage(target, message, targetOrigin) {
  if (!target || target.closed || !isScenePlayerAllowedOrigin(targetOrigin)) {
    return false;
  }
  target.postMessage(
    { channel: SCENE_PREVIEW_CHANNEL, version: SCENE_PREVIEW_VERSION, ...message },
    targetOrigin
  );
  return true;
}

function previewRequest(locationLike = window.location) {
  const params = new URLSearchParams(locationLike.search || "");
  const active = params.get("scenePreview") === "1" || params.get("editorPreview") === "1";
  const openerOrigin = params.get("openerOrigin") || "";
  const session = params.get("bridgeSession") || "";
  return {
    active,
    openerOrigin: isScenePlayerAllowedOrigin(openerOrigin) ? openerOrigin : null,
    session: session || null
  };
}

/**
 * @param {{
 *   applyPayload: (payload: object, context: { label?: string, bindSceneEvents?: boolean }) => Promise<void>,
 *   onLoaded?: (ok: boolean, error?: string) => void
 * }} options
 */
export function createScenePlayerPreviewReceiver(options) {
  const request = previewRequest();
  let installed = false;
  let loadingGeneration = 0;
  let messageHandler = null;

  function signal(action, extra = {}) {
    if (!window.opener || window.opener.closed || !request.openerOrigin || !request.session) {
      return false;
    }
    return postScenePreviewMessage(
      window.opener,
      { action, session: request.session, ...extra },
      request.openerOrigin
    );
  }

  async function handleLoad(data) {
    const generation = ++loadingGeneration;
    try {
      if (!data.payload || typeof data.payload !== "object") {
        throw new Error("Preview message is missing a valid scene payload.");
      }
      await options.applyPayload(data.payload, {
        label: data.label,
        bindSceneEvents: data.bindSceneEvents
      });
      if (generation !== loadingGeneration) {
        return;
      }
      signal("loaded", { ok: true });
      options.onLoaded?.(true);
    } catch (error) {
      if (generation !== loadingGeneration) {
        return;
      }
      const message = String(error?.message || error);
      signal("loaded", { ok: false, error: message });
      options.onLoaded?.(false, message);
    }
  }

  function install() {
    if (installed || !request.active || !request.openerOrigin || !request.session) {
      return false;
    }
    installed = true;
    messageHandler = (event) => {
      if (
        !isScenePreviewMessageEvent(event) ||
        event.origin !== request.openerOrigin ||
        event.source !== window.opener ||
        event.data?.session !== request.session ||
        event.data?.action !== "load"
      ) {
        return;
      }
      void handleLoad(event.data);
    };
    window.addEventListener("message", messageHandler);
    return true;
  }

  function bootstrap() {
    if (!install()) {
      return false;
    }
    window.setTimeout(() => signal("ready"), 0);
    window.setTimeout(() => signal("ready"), 250);
    return true;
  }

  function dispose() {
    if (messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    installed = false;
  }

  return { isActive: () => request.active, bootstrap, dispose };
}
