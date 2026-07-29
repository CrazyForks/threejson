/**
 * Scene Shower's independent one-time scene-transfer bridge.
 *
 * This app deliberately owns its peer configuration; it does not import legacy scene-host code or
 * another React app's source tree.
 */

export const SCENE_TRANSFER_CHANNEL = "threejson:scene-transfer";
export const SCENE_TRANSFER_VERSION = 1;

const ENV = import.meta.env || {};
const IS_DEVELOPMENT = Boolean(ENV.DEV);
const HANDSHAKE_TIMEOUT_MS = 15000;

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

function configuredEditorUrl() {
  const fallback = IS_DEVELOPMENT ? "http://localhost:5183/" : "https://editor.threejson.org/";
  const candidate = String(ENV.VITE_THREEJSON_EDITOR_URL || fallback).trim();
  try {
    return new URL(candidate).href;
  } catch {
    return new URL(fallback).href;
  }
}

export const SCENE_SHOWER_EDITOR_URL = configuredEditorUrl();
export const SCENE_SHOWER_ALLOWED_ORIGINS = Object.freeze([
  ...new Set([...PRODUCTION_ORIGINS, ...DEVELOPMENT_ORIGINS, new URL(SCENE_SHOWER_EDITOR_URL).origin])
]);

function isAllowedOrigin(origin) {
  return typeof origin === "string" && SCENE_SHOWER_ALLOWED_ORIGINS.includes(origin);
}

function createSession() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  const values = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(values);
  return `${Date.now().toString(36)}-${Array.from(values, (value) => value.toString(36)).join("")}`;
}

/** Open the editor and transfer a payload only after its explicit ready acknowledgement. */
export function openSceneInEditor(sceneJson, label) {
  const targetOrigin = new URL(SCENE_SHOWER_EDITOR_URL).origin;
  const openerOrigin = typeof window !== "undefined" ? window.location.origin : null;
  if (!isAllowedOrigin(targetOrigin) || !isAllowedOrigin(openerOrigin)) {
    return Promise.reject(new Error("The configured scene editor is not in the application origin allowlist."));
  }

  const session = createSession();
  const targetUrl = new URL(SCENE_SHOWER_EDITOR_URL);
  targetUrl.searchParams.set("sceneTransfer", "1");
  targetUrl.searchParams.set("bridgeSession", session);
  targetUrl.searchParams.set("openerOrigin", openerOrigin);
  const popup = window.open(targetUrl.href, "threejson-editor-scene-transfer");
  if (!popup) {
    return Promise.reject(new Error("Popup blocked."));
  }

  return new Promise((resolve, reject) => {
    let sent = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
    };
    const fail = (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onMessage = (event) => {
      const data = event?.data;
      if (
        event.origin !== targetOrigin ||
        event.source !== popup ||
        !data ||
        typeof data !== "object" ||
        data.channel !== SCENE_TRANSFER_CHANNEL ||
        data.version !== SCENE_TRANSFER_VERSION ||
        data.session !== session
      ) {
        return;
      }
      if (data.action === "ready" && !sent) {
        sent = true;
        popup.postMessage(
          {
            channel: SCENE_TRANSFER_CHANNEL,
            version: SCENE_TRANSFER_VERSION,
            action: "load",
            session,
            payload: sceneJson,
            label
          },
          targetOrigin
        );
        return;
      }
      if (data.action === "loaded") {
        if (data.ok === false) {
          fail(new Error(data.error || "The scene editor could not load the scene."));
          return;
        }
        cleanup();
        resolve({ session });
      }
    };
    const timeoutId = window.setTimeout(() => fail(new Error("Scene editor handshake timed out.")), HANDSHAKE_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
  });
}
