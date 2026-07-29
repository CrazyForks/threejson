/**
 * App-wide ThreeBox settings state. Mirrors the role of threebox-cloud's threeBoxSettingsController
 * (a module singleton, because boot-time code and many components read settings whether or not the
 * settings modal is mounted) but implemented with React's useSyncExternalStore instead of a bespoke
 * subscription class.
 *
 * The singleton loads once from localStorage (loadThreeBoxSettingsBundle, which merges defaults and
 * seeds the built-in provider), and setThreeBoxSettings persists via persistThreeBoxSettings (which
 * honours ai.rememberKeys / sync.rememberAccessToken).
 */
import { useSyncExternalStore } from "react";
import {
  cloneThreeBoxSettings,
  getSettingsByPath,
  loadThreeBoxSettingsBundle,
  persistThreeBoxSettings
} from "./lib/threeBoxSettingsStore.js";

let current = loadThreeBoxSettingsBundle();
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

export function getThreeBoxSettings() {
  return current;
}

/** Replaces the whole settings object (used by the modal's Save) and persists it. */
export function setThreeBoxSettings(next) {
  current = cloneThreeBoxSettings(next);
  persistThreeBoxSettings(current);
  emit();
}

/**
 * Applies a mutating `updater(draft)` to a clone of the current settings and persists it. Mirrors
 * the original's settingsModal.updateSettings duck-typed contract used by threeBoxBuiltinProvider /
 * notifications / sync. `options` is accepted for signature parity (notify/toast/closeModal) — this
 * store always notifies subscribers on change; toast/closeModal are the caller's concern here.
 * @param {(draft: object) => void} updater
 * @returns {object} the new settings
 */
export function updateThreeBoxSettings(updater) {
  const next = cloneThreeBoxSettings(current);
  updater(next);
  setThreeBoxSettings(next);
  return current;
}

/** A duck-typed controller matching the original's settingsModal shape, for modules ported from the
 * vanilla app (threeBoxBuiltinProvider, notifications, sync). */
export const threeBoxSettingsController = {
  getSettings: getThreeBoxSettings,
  updateSettings: (updater) => updateThreeBoxSettings(updater)
};

/** Patches a single dotted path (used for one-off toggles outside the modal) and persists. */
export function patchThreeBoxSetting(path, value) {
  const next = cloneThreeBoxSettings(current);
  const parts = String(path).split(".");
  let cur = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== "object") {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  setThreeBoxSettings(next);
}

/** Subscribe a component to the whole settings object. */
export function useThreeBoxSettings() {
  return useSyncExternalStore(subscribe, getThreeBoxSettings, getThreeBoxSettings);
}

/** Subscribe a component to a single dotted path (re-renders only when that value changes). */
export function useThreeBoxSetting(path) {
  return useSyncExternalStore(
    subscribe,
    () => getSettingsByPath(current, path),
    () => getSettingsByPath(current, path)
  );
}
