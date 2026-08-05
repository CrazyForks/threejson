/**
 * App-wide editor settings state, ported from tools/scene-host/editor/js/settingsModal.js's
 * controller responsibilities (not the modal UI itself — that's SettingsModal.jsx). Unlike
 * ThreeBox, the schema/store logic is already packaged (@threejson/host-kit's
 * editorSettingsSchema.js / editorSettingsStore.js) — this file is only the thin React
 * singleton-store binding, mirroring apps/threebox/src/useThreeBoxSettings.js's
 * useSyncExternalStore pattern.
 *
 * host-kit's `loadEditorSettingsBundle()` is async (it fetches a JSON file of server-side
 * defaults before merging local overrides) — unlike ThreeBox's synchronous store init. Rather
 * than block first paint on that fetch, the store starts synchronously from
 * EDITOR_SETTINGS_DEFAULTS + any local cache, then upgrades to the fetched bundle once it
 * resolves (silently — nothing in this app depends on the remote file defaults being present
 * before boot).
 */
import { useSyncExternalStore } from "react";
import {
  EDITOR_SETTINGS_DEFAULTS,
  EDITOR_SETTINGS_SECTIONS,
  EDITOR_SETTINGS_FIELDS
} from "@threejson/host-kit/js/editorSettingsSchema.js";
import {
  cloneEditorSettings,
  deepMergeEditorSettings,
  getSettingsByPath,
  loadEditorSettingsBundle,
  persistEditorSettings,
  readEditorSettingsCache,
  setSettingsByPath
} from "@threejson/host-kit/js/editorSettingsStore.js";

export { EDITOR_SETTINGS_SECTIONS, EDITOR_SETTINGS_FIELDS, getSettingsByPath, setSettingsByPath, cloneEditorSettings };

let current = deepMergeEditorSettings(EDITOR_SETTINGS_DEFAULTS, readEditorSettingsCache() || {});
const listeners = new Set();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

void loadEditorSettingsBundle().then((bundle) => {
  // Only adopt the remote file defaults if nothing has changed the store meanwhile (e.g. via
  // setEditorSettings before the fetch resolved) — a merge here, not an overwrite, could
  // silently drop that change.
  current = deepMergeEditorSettings(bundle.settings, cloneEditorSettings(current));
  emit();
});

export function getEditorSettings() {
  return current;
}

export function setEditorSettings(next) {
  current = cloneEditorSettings(next);
  persistEditorSettings(current);
  emit();
}

export function useEditorSettings() {
  return useSyncExternalStore(subscribe, getEditorSettings, getEditorSettings);
}
