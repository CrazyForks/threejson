import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  THREEBOX_SETTINGS_FIELDS,
  THREEBOX_SETTINGS_DEFAULTS,
  THREEBOX_SETTINGS_STORAGE_KEY
} from "../tools/scene-host/threebox/js/threeBoxSettingsSchema.js";
import {
  loadThreeBoxSettingsBundle,
  persistThreeBoxSettings
} from "../tools/scene-host/threebox/js/threeBoxSettingsStore.js";
import { resolveThreeBoxSceneTokenOptions } from "../tools/scene-host/threebox/js/threeBoxOrchestrator.js";

const originalLocalStorage = globalThis.localStorage;

function installMemoryLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
  return store;
}

afterEach(() => {
  globalThis.localStorage = originalLocalStorage;
});

test("ThreeBox defaults remember API keys locally", () => {
  installMemoryLocalStorage();
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.rememberKeys, true);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.onlineTextureHints, true);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.maxSceneSegments, 16);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.general.previewAuxiliaryLights, true);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.io.sceneJsonFormat, "standard");
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.io.showMeshExportWarnings, true);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.maxAutoRefineRounds, 6);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.agentPolicyVersion, 2);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.sceneGenerationMode, "auto");
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.sceneMaxOutputTokens, 0);
  assert.equal(THREEBOX_SETTINGS_DEFAULTS.ai.thinkingPreference, "disabled");
  const generationModeField = THREEBOX_SETTINGS_FIELDS.find(
    (field) => field.path === "ai.sceneGenerationMode"
  );
  assert.deepEqual(
    generationModeField?.options?.map(([value]) => value),
    ["auto", "direct", "draft_refine"]
  );
  const thinkingField = THREEBOX_SETTINGS_FIELDS.find(
    (field) => field.path === "ai.thinkingPreference"
  );
  assert.deepEqual(
    thinkingField?.options?.map(([value]) => value),
    ["disabled", "high", "max", "inherit"]
  );
  assert.equal(
    THREEBOX_SETTINGS_FIELDS.find((field) => field.path === "ai.sceneMaxOutputTokens")?.min,
    0
  );
  const settings = loadThreeBoxSettingsBundle();
  assert.equal(settings.ai.rememberKeys, true);
  assert.equal(settings.ai.animationCapabilityMode, "auto");
  assert.equal(settings.ai.onlineTextureHints, true);
  assert.equal(settings.ai.maxSceneSegments, 16);
  assert.equal(settings.general.previewAuxiliaryLights, true);
  assert.equal(settings.io.sceneJsonFormat, "standard");
  assert.equal(settings.io.showMeshExportWarnings, true);
  assert.equal(settings.ai.maxAutoRefineRounds, 6);
  assert.equal(settings.ai.agentPolicyVersion, 2);
  assert.equal(settings.ai.sceneGenerationMode, "auto");
  assert.equal(settings.ai.sceneMaxOutputTokens, 0);
  assert.equal(settings.ai.thinkingPreference, "disabled");
});

test("ThreeBox keeps the scene output ceiling opt-in", () => {
  const store = installMemoryLocalStorage();
  store.set(
    THREEBOX_SETTINGS_STORAGE_KEY,
    JSON.stringify({ ai: { sceneMaxOutputTokens: 12000 } })
  );
  assert.equal(loadThreeBoxSettingsBundle().ai.sceneMaxOutputTokens, 12000);
  assert.deepEqual(resolveThreeBoxSceneTokenOptions(loadThreeBoxSettingsBundle()), { maxTokens: 12000 });
  store.set(
    THREEBOX_SETTINGS_STORAGE_KEY,
    JSON.stringify({ ai: { sceneMaxOutputTokens: -5 } })
  );
  assert.equal(loadThreeBoxSettingsBundle().ai.sceneMaxOutputTokens, 0);
  assert.deepEqual(resolveThreeBoxSceneTokenOptions(loadThreeBoxSettingsBundle()), {});
});

test("ThreeBox persists valid generation modes and repairs invalid cached values", () => {
  const store = installMemoryLocalStorage();
  persistThreeBoxSettings({
    ai: { sceneGenerationMode: "draft_refine", providers: [], rememberKeys: true }
  });
  assert.equal(loadThreeBoxSettingsBundle().ai.sceneGenerationMode, "draft_refine");

  store.set(
    THREEBOX_SETTINGS_STORAGE_KEY,
    JSON.stringify({ ai: { sceneGenerationMode: "legacy-always-refine" } })
  );
  assert.equal(loadThreeBoxSettingsBundle().ai.sceneGenerationMode, "auto");
});

test("ThreeBox persists valid thinking preferences and repairs unsupported values", () => {
  const store = installMemoryLocalStorage();
  persistThreeBoxSettings({
    ai: { thinkingPreference: "max", providers: [], rememberKeys: true }
  });
  assert.equal(loadThreeBoxSettingsBundle().ai.thinkingPreference, "max");

  store.set(
    THREEBOX_SETTINGS_STORAGE_KEY,
    JSON.stringify({ ai: { thinkingPreference: "low" } })
  );
  assert.equal(loadThreeBoxSettingsBundle().ai.thinkingPreference, "disabled");
});

test("ThreeBox migrates the legacy always-refine limit away from 20", () => {
  const store = installMemoryLocalStorage();
  store.set(
    THREEBOX_SETTINGS_STORAGE_KEY,
    JSON.stringify({ ai: { maxAutoRefineRounds: 20 } })
  );
  const settings = loadThreeBoxSettingsBundle();
  assert.equal(settings.ai.maxAutoRefineRounds, 6);
  assert.equal(settings.ai.agentPolicyVersion, 2);
});

test("ThreeBox persists the animation capability negotiation mode", () => {
  installMemoryLocalStorage();
  persistThreeBoxSettings({ ai: { animationCapabilityMode: "off", providers: [], rememberKeys: true } });
  assert.equal(loadThreeBoxSettingsBundle().ai.animationCapabilityMode, "off");
});

test("ThreeBox migrates the legacy friendly-copy preference to the JSON format setting", () => {
  const store = installMemoryLocalStorage();
  store.set(THREEBOX_SETTINGS_STORAGE_KEY, JSON.stringify({ io: { copyFriendlyJson: true } }));
  assert.equal(loadThreeBoxSettingsBundle().io.sceneJsonFormat, "friendly");
});

test("ThreeBox persists the model-export warning dialog preference", () => {
  installMemoryLocalStorage();
  persistThreeBoxSettings({ io: { showMeshExportWarnings: false } });
  assert.equal(loadThreeBoxSettingsBundle().io.showMeshExportWarnings, false);
});

test("ThreeBox persists the preview auxiliary-lights preference", () => {
  installMemoryLocalStorage();
  persistThreeBoxSettings({ general: { previewAuxiliaryLights: false } });
  assert.equal(loadThreeBoxSettingsBundle().general.previewAuxiliaryLights, false);
});

test("ThreeBox persist keeps keys by default and clears them when rememberKeys is false", () => {
  const store = installMemoryLocalStorage();
  persistThreeBoxSettings({
    ai: {
      rememberKeys: true,
      providers: [{ id: "p1", apiKey: "secret" }]
    }
  });
  let saved = JSON.parse(Array.from(store.values())[0]);
  assert.equal(saved.ai.providers[0].apiKey, "secret");

  store.clear();
  persistThreeBoxSettings({
    ai: {
      rememberKeys: false,
      providers: [{ id: "p1", apiKey: "secret" }]
    }
  });
  saved = JSON.parse(Array.from(store.values())[0]);
  assert.equal(saved.ai.providers[0].apiKey, "");
});
