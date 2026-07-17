import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { updateSceneAnimations } from "../core/handler/animationHandler.js";

test("declarative transform animation advances smoothly in the scene frame loop", () => {
  const scene = new THREE.Scene();
  const object = new THREE.Object3D();
  object.userData.objJson = {
    animations: [{ type: "transform", property: "position", from: [0, 0, 0], to: [10, 0, 0], duration: 1000 }]
  };
  scene.add(object);
  updateSceneAnimations(scene, 0.5, { maxDeltaSeconds: 0.5 });
  assert.equal(object.position.x, 5);
  updateSceneAnimations(scene, 0.5, { maxDeltaSeconds: 0.5 });
  assert.equal(object.position.x, 10);
});

test("declarative expression animation supports generic PI math tracks", () => {
  const scene = new THREE.Scene();
  const object = new THREE.Object3D();
  object.userData.objJson = {
    animations: [{ type: "expression", property: "position", expressions: { x: "10*cos(PI*t)", y: "0", z: "6*sin(PI*t)" } }]
  };
  scene.add(object);
  updateSceneAnimations(scene, 0.5, { maxDeltaSeconds: 0.5 });
  assert.ok(Math.abs(object.position.x) < 1e-10);
  assert.ok(Math.abs(object.position.z - 6) < 1e-10);
});
