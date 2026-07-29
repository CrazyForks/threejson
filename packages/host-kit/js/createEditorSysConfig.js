import { createSceneHostSysConfig } from "./createSceneHostSysConfig.js";

/** Editor adapter over the host-neutral sysConfig baseline. */
export function createEditorSysConfig() {
  return createSceneHostSysConfig();
}
