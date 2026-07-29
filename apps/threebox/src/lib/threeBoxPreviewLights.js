/**
 * Ported from tools/scene-host/threebox/js/threeBoxPreviewLights.js (app-local). Adds host-only
 * fill lights to an inline preview scene so a scene authored without lights is still visible in the
 * card; the tagged top-level group is excluded from mesh export by the engine's existing rules.
 */
import * as THREE from "three";

export const THREEBOX_PREVIEW_LIGHTS_NAME = "__threebox_preview_auxiliary_lights__";

export function removeThreeBoxPreviewAuxiliaryLights(scene) {
  if (!scene?.children) {
    return false;
  }
  let removed = false;
  for (let index = scene.children.length - 1; index >= 0; index -= 1) {
    const child = scene.children[index];
    if (child?.name === THREEBOX_PREVIEW_LIGHTS_NAME || child?.userData?.__threeBoxPreviewOnly === true) {
      scene.remove(child);
      removed = true;
    }
  }
  return removed;
}

export function syncThreeBoxPreviewAuxiliaryLights(scene, enabled = true) {
  if (scene) {
    removeThreeBoxPreviewAuxiliaryLights(scene);
  }
  if (!enabled || !scene?.isScene) {
    return null;
  }

  const group = new THREE.Group();
  group.name = THREEBOX_PREVIEW_LIGHTS_NAME;
  group.userData = {
    __threeBoxPreviewOnly: true,
    objJson: { objType: "light", type: "threebox-preview-auxiliary" }
  };

  const ambient = new THREE.AmbientLight("#ffffff", 0.55);
  ambient.name = "ThreeBox Preview Ambient";
  const directional = new THREE.DirectionalLight("#ffffff", 0.75);
  directional.name = "ThreeBox Preview Directional";
  directional.position.set(260, 420, 380);
  directional.target.position.set(0, 0, 0);
  directional.castShadow = false;
  group.add(ambient, directional, directional.target);
  scene.add(group);
  return group;
}
