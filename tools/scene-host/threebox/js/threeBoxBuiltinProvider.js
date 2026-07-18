import { THREEBOX_BUILTIN_PROVIDER_ID, THREEBOX_BUILTIN_PROVIDER_TYPE } from "./threeBoxSettingsSchema.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t } from "../../shared/i18n/index.js";

/**
 * Shared HMAC secret used to sign `/v1/auth/issue` requests to the built-in provider's backend
 * (tmpserver/threebox-server — see its README for the matching `REQUEST_SIGNING_SECRET`). This is
 * a deterrent against scripted abuse (proves the caller has ThreeBox's client secret, not just a
 * spoofable Origin header), not a hard guarantee: ThreeBox is open source, so the secret is
 * technically extractable from this file. The real backstop is the backend's per-device quota and
 * ban policy. Self-hosting your own backend? Change this to match your own deployed
 * `REQUEST_SIGNING_SECRET`, or leave the official threebox.org default and just override
 * `ai.builtinBackendUrl` in Settings if you only want to swap the endpoint.
 */
const REQUEST_SIGNING_SECRET = "threebox-public-client-2024";

const KEY_REISSUE_MARGIN_MS = 24 * 60 * 60 * 1000; // re-issue a day before actual expiry

let cachedFingerprintPromise = null;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

/** Best-effort, low-churn canvas signal — wrapped in try/catch because privacy-hardened browsers
 * (e.g. Brave) may block or randomize canvas reads; a blank fallback just means this device leans
 * more on its other signals. */
function canvasSignal() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 80, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("ThreeBox device signal", 2, 15);
    return canvas.toDataURL();
  } catch {
    return "";
  }
}

function webglSignal() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (!info) return "";
    return `${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)}::${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}`;
  } catch {
    return "";
  }
}

/**
 * Computes a stable per-device fingerprint by hashing low-churn browser/hardware signals — never
 * read from storage, so the same browser reproduces the same value even after clearing all site
 * data. Deliberately excludes `navigator.userAgent` (its version segment changes on every browser
 * auto-update, which would silently rotate the "identity" and defeat the point). Not
 * cryptographically unique across all devices — it doesn't need to be; see threebox-server's
 * README for how the backend treats this as a soft identity signal, not a hard guarantee.
 */
export function computeDeviceFingerprint() {
  if (!cachedFingerprintPromise) {
    cachedFingerprintPromise = (async () => {
      let timeZone = "";
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      } catch {
        /* ignore */
      }
      const parts = [
        String(screen.width || ""),
        String(screen.height || ""),
        String(screen.colorDepth || ""),
        String(navigator.hardwareConcurrency || ""),
        navigator.language || "",
        navigator.platform || "",
        timeZone,
        canvasSignal(),
        webglSignal()
      ];
      return sha256Hex(parts.join("|"));
    })();
  }
  return cachedFingerprintPromise;
}

/** Short, shareable form for support requests — must match threebox-server's
 * `shortDeviceId()` (src/lib/deviceId.ts) exactly so what the user sees in Settings matches what
 * you search for in the admin dashboard. */
export async function getDisplayDeviceId() {
  const deviceId = await computeDeviceFingerprint();
  return `TB-${deviceId.slice(0, 10).toUpperCase()}`;
}

function randomNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function signIssueRequest(deviceId) {
  const ts = Date.now();
  const nonce = randomNonce();
  const sig = await hmacSha256Hex(REQUEST_SIGNING_SECRET, `${deviceId}.${ts}.${nonce}`);
  return { deviceId, ts, nonce, sig };
}

function findBuiltinProvider(settings) {
  const providers = Array.isArray(settings?.ai?.providers) ? settings.ai.providers : [];
  return providers.find((p) => p.provider === THREEBOX_BUILTIN_PROVIDER_TYPE) || null;
}

function backendUrl(settings) {
  return String(settings?.ai?.builtinBackendUrl || "").replace(/\/$/, "");
}

/** Shown once per failed boot attempt — only when there's no already-working cached key to fall
 * back on (see below), so a transient failure to *renew* a still-valid key doesn't nag the user.
 * Deliberately the default "info" toast style, not "warning"/"error": ThreeBox worked perfectly
 * well before it had a built-in provider at all, purely from a manually configured one, so this
 * isn't a failure state for the app — it's just letting the user know why the zero-config path
 * isn't available right now. */
function notifyBuiltinProviderUnavailable() {
  showToast(
    t("threebox.builtin.unavailableToast", "内置供应商无法访问，请配置供应商。"),
    "info"
  );
}

/**
 * Issues (or silently re-issues, ahead of expiry) the built-in provider's trial API key and
 * writes it back into `ai.providers[]` via `settingsModal.updateSettings`. Safe to call on every
 * ThreeBox boot — it's a no-op once a non-expiring-soon key is already present. The issued key is
 * written regardless of `ai.rememberKeys`: it's a low-value, backend-revocable trial credential,
 * not a user-owned secret, so the "don't remember my key" privacy setting shouldn't force
 * re-issuing a new device registration on every reload.
 *
 * Graceful degradation: if the backend can't be reached (or isn't configured), this simply
 * returns without an apiKey — the built-in provider entry then behaves exactly like an
 * unconfigured "custom" provider (see resolveProviderOptions in threeBoxOrchestrator.js), so
 * ThreeBox falls back to needing the user to add/select a working provider, same as it always did
 * before this feature existed. Nothing here blocks boot or throws past this function.
 * @param {{getSettings: () => object, updateSettings: (updater: (draft: object) => void, options?: object) => object}} settingsModal
 */
export async function ensureBuiltinApiKey(settingsModal) {
  const settings = settingsModal.getSettings();
  const provider = findBuiltinProvider(settings);
  if (!provider) {
    return;
  }
  const now = Date.now();
  const expiresAt = Number(provider.builtinKeyExpiresAt || 0);
  if (provider.apiKey && expiresAt - now > KEY_REISSUE_MARGIN_MS) {
    return;
  }

  const base = backendUrl(settings);
  if (!base) {
    if (!provider.apiKey) {
      notifyBuiltinProviderUnavailable();
    }
    return;
  }
  try {
    const deviceId = await computeDeviceFingerprint();
    const signed = await signIssueRequest(deviceId);
    const res = await fetch(`${base}/v1/auth/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signed)
    });
    if (!res.ok) {
      console.warn(`[threebox] built-in provider key issuance failed (${res.status}).`);
      if (!provider.apiKey) {
        notifyBuiltinProviderUnavailable();
      }
      return;
    }
    const body = await res.json();
    settingsModal.updateSettings(
      (draft) => {
        const draftProvider = findBuiltinProvider(draft);
        if (!draftProvider) return;
        draftProvider.apiKey = body.apiKey;
        draftProvider.builtinKeyExpiresAt = body.expiresAt;
        draftProvider.builtinShortId = body.shortId;
        draftProvider.builtinQuota = body.quota;
      },
      { notify: true, toast: false, closeModal: false }
    );
  } catch (error) {
    console.warn("[threebox] built-in provider key issuance failed:", error);
    if (!provider.apiKey) {
      notifyBuiltinProviderUnavailable();
    }
  }
}

/**
 * Refreshes the cached quota snapshot from the backend (GET /v1/quota) — used by the settings
 * panel so the displayed "剩余额度" isn't stale from whenever the key happened to be issued.
 * Fails silently (returns the last-known cached quota) since this is a best-effort UI refresh.
 * Only persists when the fetched values actually differ from the cached ones — `updateSettings`
 * re-renders the (currently open) settings panel, which would rebuild this same provider card and
 * call back into this function; committing unconditionally would loop for as long as the panel
 * stays open, so this only writes through on a real change (and a same-value refetch on the
 * resulting re-render then no-ops, ending the chain after at most one extra render).
 */
export async function refreshBuiltinQuota(settingsModal) {
  const settings = settingsModal.getSettings();
  const provider = findBuiltinProvider(settings);
  const base = backendUrl(settings);
  if (!provider?.apiKey || !base) {
    return provider?.builtinQuota || null;
  }
  try {
    const res = await fetch(`${base}/v1/quota`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` }
    });
    if (!res.ok) {
      return provider.builtinQuota || null;
    }
    const body = await res.json();
    const changed =
      JSON.stringify(body.quota) !== JSON.stringify(provider.builtinQuota) ||
      body.shortId !== provider.builtinShortId;
    if (changed) {
      settingsModal.updateSettings(
        (draft) => {
          const draftProvider = findBuiltinProvider(draft);
          if (!draftProvider) return;
          draftProvider.builtinQuota = body.quota;
          draftProvider.builtinShortId = body.shortId;
        },
        { notify: false, toast: false, closeModal: false }
      );
    }
    return body.quota;
  } catch {
    return provider.builtinQuota || null;
  }
}

export function isBuiltinProviderId(id) {
  return id === THREEBOX_BUILTIN_PROVIDER_ID;
}
