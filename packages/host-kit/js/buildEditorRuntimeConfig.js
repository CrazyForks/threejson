import {
  buildSceneHostRuntimeConfig,
  buildSceneHostScenePayload
} from "./buildSceneHostRuntimeConfig.js";

/** Editor adapter over the host-neutral runtime config builder. */
export function buildEditorRuntimeConfig(sysConfig, editorSettings, baseSceneConfig = {}) {
  return buildSceneHostRuntimeConfig(sysConfig, editorSettings, baseSceneConfig);
}

/** Editor adapter over the host-neutral scene payload builder. */
export function buildEditorScenePayload(sysConfig, editorSettings) {
  return buildSceneHostScenePayload(sysConfig, editorSettings);
}
