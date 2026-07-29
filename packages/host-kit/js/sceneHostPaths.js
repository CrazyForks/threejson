/**
 * Ported from tools/scene-host/shared/js/sceneHostPaths.js. The original resolved paths relative
 * to the monorepo's own repo root (`new URL("../../../../", import.meta.url)`, climbing from
 * shared/js/ up to the folder containing assets/) — that assumption only held because
 * tools/scene-host always runs from inside this repo with a local assets/ folder alongside it. A
 * standalone npm install of @threejson/host-kit has no such folder, so this resolves against the
 * published @threejson/assets CDN base by default instead.
 *
 * Deliberately independent of threejson/core's own mutable asset-base state (setAssetsBaseUrl/
 * getAssetsBaseUrl) — that state is scoped to the *engine's* per-texture/model loading (with its
 * own local-first-then-CDN candidate fallback), a different concern from resolving a single
 * definitive URL for host-level assets (template manifests, sample scenes, settings templates).
 * Consuming apps that want host asset resolution to point somewhere else (a self-hosted mirror, a
 * bundled Electron build) call setHostAssetsBase() explicitly; nothing here reaches for the
 * engine's global config as a side effect.
 *
 * The original's special-cased "demo.html" -> examples/html-demo/demo.html rewrite is dropped: that
 * path only exists inside the ThreeJSON monorepo's own examples/ folder, never in a published
 * package, so there is no portable target to rewrite it to.
 */
import { DEFAULT_CDN_ASSETS_BASE } from "threejson/core";

let hostAssetsBase = DEFAULT_CDN_ASSETS_BASE;

/** Overrides the base URL host-level asset resolution resolves against (default: the published
 * @threejson/assets CDN). Pass e.g. "/assets" for an app that bundles/serves its own copy. */
export function setHostAssetsBase(url) {
  const normalized = String(url || "").trim().replace(/\/+$/, "");
  hostAssetsBase = normalized || DEFAULT_CDN_ASSETS_BASE;
}

export function getHostAssetsBase() {
  return hostAssetsBase;
}

function stripLegacyPrefix(value) {
  return String(value || "")
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    // The original resolved against a base whose *parent* was the assets/ folder's own parent
    // (repo root), so callers' paths carried a leading "assets/" segment. @threejson/assets
    // publishes the assets/ folder's *contents* at its package root (no redundant prefix), so that
    // segment must be stripped before resolving against the CDN base.
    .replace(/^assets\//, "");
}

/**
 * @param {string} path e.g. "assets/json/other/threebox/manifest.json" or "json/portShow.json"
 * @returns {string}
 */
export function sceneHostAssetUrl(path = "") {
  const clean = stripLegacyPrefix(path);
  return clean ? `${hostAssetsBase}/${clean}` : hostAssetsBase;
}

/**
 * @param {string} value a relative host-asset path, or an already-absolute/data/blob URL (passed
 *   through unchanged)
 * @returns {string}
 */
export function resolveSceneHostUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return raw;
  }
  if (/^(?:[a-z]+:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }
  return sceneHostAssetUrl(raw);
}
