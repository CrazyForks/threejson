/**
 * React binding for @threejson/host-kit's player settings store.
 *
 * host-kit's store is async at load time (it fetches the shipped setting.json defaults, then merges
 * the localStorage cache over them) and synchronous for writes. This hook owns that lifecycle:
 * loads once on mount, exposes the merged settings plus the file defaults (needed by a
 * "restore defaults" action), and re-renders on save/reset.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clonePlayerSettings,
  fetchPlayerSettingsFileDefaults,
  clearPlayerSettingsCache,
  loadPlayerSettingsBundle,
  persistPlayerSettings,
  setPlayerSettingsByPath
} from "@threejson/host-kit/js/playerSettingsStore.js";

/**
 * @returns {{ settings: object|null, fileDefaults: object|null, loading: boolean,
 *   save: (next: object) => void, setByPath: (path: string, value: any) => void,
 *   resetToFileDefaults: () => Promise<object> }}
 */
export function usePlayerSettings() {
  const [settings, setSettings] = useState(null);
  const [fileDefaults, setFileDefaults] = useState(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadPlayerSettingsBundle()
      .then((bundle) => {
        if (!mountedRef.current) {
          return;
        }
        setSettings(bundle.settings);
        setFileDefaults(bundle.fileDefaults);
      })
      .finally(() => {
        if (mountedRef.current) {
          setLoading(false);
        }
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Persists and applies a full settings object. */
  const save = useCallback((next) => {
    persistPlayerSettings(next);
    setSettings(clonePlayerSettings(next));
  }, []);

  /** Convenience for schema-driven forms: write one dotted path, persist, re-render. */
  const setByPath = useCallback((path, value) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      const next = clonePlayerSettings(prev);
      setPlayerSettingsByPath(next, path, value);
      persistPlayerSettings(next);
      return next;
    });
  }, []);

  /** Drops the localStorage cache and returns to the shipped setting.json defaults. */
  const resetToFileDefaults = useCallback(async () => {
    const defaults = await fetchPlayerSettingsFileDefaults();
    clearPlayerSettingsCache();
    if (mountedRef.current) {
      setFileDefaults(defaults);
      setSettings(clonePlayerSettings(defaults));
    }
    return defaults;
  }, []);

  return { settings, fileDefaults, loading, save, setByPath, resetToFileDefaults };
}
