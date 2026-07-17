import {
  buildSceneHostRuntimeConfig,
  buildSceneHostScenePayload
} from "./buildSceneHostRuntimeConfig.js";

/** Player adapter over the host-neutral runtime config builder. */
export function buildPlayerRuntimeConfig(sysConfig, playerSettings, baseSceneConfig = {}) {
  return buildSceneHostRuntimeConfig(sysConfig, playerSettings, baseSceneConfig);
}

/** Player adapter over the host-neutral scene payload builder. */
export function buildPlayerScenePayload(sysConfig, playerSettings) {
  return buildSceneHostScenePayload(sysConfig, playerSettings);
}
