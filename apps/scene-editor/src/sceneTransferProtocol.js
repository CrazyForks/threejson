/**
 * Scene editor's independent receiver for one-time `window.open()` scene transfers.
 *
 * This origin configuration is intentionally local to the React editor. It must not be coupled to
 * the legacy scene-host protocol because the React apps are intended to become independently
 * deployable products.
 */

export const SCENE_TRANSFER_CHANNEL = "threejson:scene-transfer";
export const SCENE_TRANSFER_VERSION = 1;

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

export const SCENE_EDITOR_PEER_URLS = Object.freeze({
  editor: configuredUrl("EDITOR", "http://localhost:5183/", "https://editor.threejson.org/"),
  player: configuredUrl("PLAYER", "http://localhost:5180/", "https://player.threejson.org/"),
  shower: configuredUrl("SHOWER", "http://localhost:5181/", "https://shower.threejson.org/"),
  threebox: configuredUrl("THREEBOX", "http://localhost:5182/", "https://threebox.org/")
});

export const SCENE_EDITOR_ALLOWED_ORIGINS = Object.freeze([
  ...new Set([
    ...PRODUCTION_ORIGINS,
    ...DEVELOPMENT_ORIGINS,
    ...Object.values(SCENE_EDITOR_PEER_URLS).map((value) => new URL(value).origin)
  ])
]);

function isAllowedOrigin(origin) {
  return typeof origin === "string" && SCENE_EDITOR_ALLOWED_ORIGINS.includes(origin);
}

function readTransferRequest(locationLike = window.location) {
  const params = new URLSearchParams(locationLike.search || "");
  const active = params.get("sceneTransfer") === "1";
  const openerOrigin = params.get("openerOrigin") || "";
  const session = params.get("bridgeSession") || "";
  return {
    active,
    openerOrigin: isAllowedOrigin(openerOrigin) ? openerOrigin : null,
    session: session || null
  };
}

export function hasSceneTransferRequest(locationLike = window.location) {
  const request = readTransferRequest(locationLike);
  return request.active && Boolean(request.openerOrigin && request.session);
}

/**
 * @param {{
 *   applyPayload: (payload: object, context: { label?: string }) => Promise<void>,
 *   onStatus?: (status: "waiting"|"loaded"|"error", detail?: string) => void
 * }} options
 */
export function createSceneEditorTransferReceiver(options) {
  const request = readTransferRequest();
  let installed = false;
  let messageHandler = null;

  function post(action, extra = {}) {
    if (!window.opener || window.opener.closed || !request.openerOrigin || !request.session) {
      return false;
    }
    window.opener.postMessage(
      {
        channel: SCENE_TRANSFER_CHANNEL,
        version: SCENE_TRANSFER_VERSION,
        action,
        session: request.session,
        ...extra
      },
      request.openerOrigin
    );
    return true;
  }

  async function load(data) {
    try {
      if (!data.payload || typeof data.payload !== "object") {
        throw new Error("Transferred scene payload is missing or invalid.");
      }
      await options.applyPayload(data.payload, { label: data.label });
      post("loaded", { ok: true });
      options.onStatus?.("loaded", data.label);
    } catch (error) {
      const message = String(error?.message || error);
      post("loaded", { ok: false, error: message });
      options.onStatus?.("error", message);
    }
  }

  function bootstrap() {
    if (installed || !request.active || !request.openerOrigin || !request.session || !window.opener) {
      return false;
    }
    installed = true;
    messageHandler = (event) => {
      const data = event?.data;
      if (
        event.origin !== request.openerOrigin ||
        event.source !== window.opener ||
        !data ||
        typeof data !== "object" ||
        data.channel !== SCENE_TRANSFER_CHANNEL ||
        data.version !== SCENE_TRANSFER_VERSION ||
        data.session !== request.session ||
        data.action !== "load"
      ) {
        return;
      }
      void load(data);
    };
    window.addEventListener("message", messageHandler);
    options.onStatus?.("waiting");
    window.setTimeout(() => post("ready"), 0);
    window.setTimeout(() => post("ready"), 250);
    return true;
  }

  function dispose() {
    if (messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    installed = false;
  }

  return { bootstrap, dispose };
}
