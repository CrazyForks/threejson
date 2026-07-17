import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as THREE from "three";

import {
  captureEditorCameraView,
  restoreEditorCameraView
} from "../tools/scene-host/editor/js/editorCameraViewSnapshot.js";

test("Code/All/3D viewport changes retain camera pose and control target", () => {
  const camera = new THREE.PerspectiveCamera(50, 1.8, 0.1, 1000);
  camera.position.set(12, 8, 24);
  camera.zoom = 1.25;
  camera.lookAt(2, 3, 4);
  const controls = {
    target: new THREE.Vector3(2, 3, 4),
    updateCount: 0,
    update() {
      this.updateCount += 1;
    }
  };
  const snapshot = captureEditorCameraView(camera, controls);

  camera.position.set(0, 0, 1);
  camera.zoom = 8;
  camera.aspect = 1.6;
  controls.target.set(0, 0, 0);

  assert.equal(restoreEditorCameraView(camera, controls, snapshot), true);
  assert.deepEqual(camera.position.toArray(), [12, 8, 24]);
  assert.deepEqual(controls.target.toArray(), [2, 3, 4]);
  assert.equal(camera.zoom, 1.25);
  assert.equal(camera.aspect, 1.6, "the resized viewport aspect must be retained");
  assert.equal(controls.updateCount, 1);
});

test("editor keeps viewport gizmo attached and synchronized to the actual canvas", async () => {
  const editorSource = await readFile(
    new URL("../tools/scene-host/editor/js/editorApp.js", import.meta.url),
    "utf8"
  );
  const gizmoSource = await readFile(
    new URL("../tools/scene-host/shared/js/viewportGizmoOverlay.js", import.meta.url),
    "utf8"
  );

  assert.match(editorSource, /canvasWrap\.appendChild\(el\)/);
  assert.match(editorSource, /updateViewportGizmoOverlay\(\)/);
  assert.match(gizmoSource, /gizmo\?\.update\?\.\(\)/);
  assert.match(gizmoSource, /renderer\?\.setViewport\?\.\(viewport\)/);
  assert.match(gizmoSource, /renderer\?\.setScissor\?\.\(scissor\)/);
});
