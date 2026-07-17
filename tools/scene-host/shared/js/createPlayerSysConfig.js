import { createSceneHostSysConfig } from "./createSceneHostSysConfig.js";

/** Player adapter over the host-neutral sysConfig baseline. */
export function createPlayerSysConfig() {
  return createSceneHostSysConfig();
}
