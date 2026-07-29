/**
 * React bindings for @threejson/host-kit's i18n.
 *
 * host-kit's i18n module (ported verbatim from tools/scene-host/shared/i18n) keeps `catalog` and
 * `currentLocale` as module-level state and relies on DOM re-scanning (`applyShellI18n`) to push a
 * locale change into the page — there is no subscription API, so React components have no way to
 * know the locale changed. Rather than modify host-kit (it must stay framework-agnostic and its
 * vanilla consumers depend on the DOM-rescan behavior), this module layers a small pub-sub *around*
 * it: `setHostLocale()` performs host-kit's real locale switch, then notifies subscribers so every
 * `useHostI18n()` caller re-renders in sync.
 *
 * Always route locale changes through `setHostLocale()` from React code — calling host-kit's
 * `initHostI18n`/`loadHostLocaleCatalog` directly still switches the catalog, but no React component
 * will re-render.
 *
 * The catalog is also loaded automatically the first time any component calls `useHostI18n()`.
 * Requiring each app to remember an explicit `setHostLocale()` at boot turned out to be a footgun
 * with a silent failure mode: host-kit's `t()` falls back to *key-derived* text for a missing entry
 * ("Title" from `threebox.meshExport.title`) rather than to the supplied fallback, so an app that
 * forgot the call rendered plausible-looking nonsense instead of erroring. It bit two of the three
 * apps here — both times only after a shared component reached its second consumer — so the hook
 * that hands out `t` now guarantees `t` works.
 */
import { useCallback, useSyncExternalStore } from "react";
import { getHostLocale, initHostI18n, t as hostT } from "@threejson/host-kit/i18n/index.js";

const listeners = new Set();
// Bumped on every locale change so useSyncExternalStore sees a new snapshot even when the locale
// string is unchanged (e.g. a catalog reload for the same locale).
let version = 0;

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return version;
}

function notify() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Switches the host locale (delegating to host-kit's initHostI18n, which loads the catalog and
 * persists the choice) and re-renders every useHostI18n() consumer.
 * @param {string} [locale] a supported locale tag, or omit/"" to re-resolve from storage/navigator
 * @returns {Promise<string>} the resolved locale
 */
export async function setHostLocale(locale) {
  const resolved = await initHostI18n(locale);
  notify();
  return resolved;
}

/**
 * Subscribes the calling component to host locale changes.
 *
 * `t` is re-created on each locale change so it is safe to use directly in render and as a
 * dependency of useMemo/useCallback.
 *
 * @returns {{ locale: string, t: (key: string, fallback?: string, params?: object) => string,
 *   setLocale: (locale?: string) => Promise<string> }}
 */
/**
 * Loads the catalog once per page, resolving the locale from storage/navigator.
 *
 * Kicked off lazily rather than at module scope so that merely importing this package does no I/O
 * and touches no browser storage. The promise is cached, so concurrent mounts share one load.
 */
let autoInit = null;
function ensureCatalogLoaded() {
  if (autoInit) {
    return autoInit;
  }
  autoInit = setHostLocale().catch(() => {
    // A failed catalog load must not break rendering: t() still answers with English fallbacks.
    // Clear the cache so a later explicit setHostLocale() can retry.
    autoInit = null;
  });
  return autoInit;
}

export function useHostI18n() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Safe during render: this only starts an async load and never sets state synchronously — the
  // re-render arrives later through the subscription above.
  ensureCatalogLoaded();
  const locale = getHostLocale();
  // Identity changes with `locale` so memoized children re-render when the catalog swaps.
  const t = useCallback((key, fallback, params) => hostT(key, fallback, params), [locale]);
  const setLocale = useCallback((next) => setHostLocale(next), []);
  return { locale, t, setLocale };
}
