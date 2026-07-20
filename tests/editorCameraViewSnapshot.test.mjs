import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("editor restores the Code toolbar and has no three-view canvas path", async () => {
  const [shellSource, appSource, interactionSource] = await Promise.all([
    readFile(new URL("../tools/scene-host/editor/_shell-body.html", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/editor/js/editorApp.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/editor/js/editorInteraction.js", import.meta.url), "utf8")
  ]);

  for (const id of [
    "codeJsonScopeCoreBtn",
    "codeJsonScopeFullBtn",
    "codeEditorFormatSelect",
    "codeEditorFormatWritebackCheckbox",
    "codeEditorFormatBtn",
    "codeEditorCameraLockCheckbox",
    "codeEditorAutoRenderCheckbox",
    "codeEditorCanvasToggleBtn",
    "codeEditorRenderBtn"
  ]) {
    assert.match(shellSource, new RegExp(`id=["']${id}["']`));
  }

  assert.doesNotMatch(shellSource, /menuToggleThreeView|threeViewDebugLayer/);
  assert.doesNotMatch(appSource, /editorThreeView|getEditorThreeView|menuToggleThreeView/);
  assert.doesNotMatch(interactionSource, /editorThreeView|getEditorThreeView|threeView/);
});

test("editor shell exposes every statically referenced control and restored status actions", async () => {
  const shellSource = await readFile(
    new URL("../tools/scene-host/editor/_shell-body.html", import.meta.url),
    "utf8"
  );
  const shellIds = new Set([...shellSource.matchAll(/\bid=["']([^"']+)/g)].map((match) => match[1]));
  const jsDir = new URL("../tools/scene-host/editor/js/", import.meta.url);
  const missing = [];

  for (const entry of await readdir(jsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const source = await readFile(new URL(entry.name, jsDir), "utf8");
    for (const match of source.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!shellIds.has(match[1])) missing.push(`${entry.name}:${match[1]}`);
    }
  }

  assert.deepEqual(missing, []);
  for (const id of [
    "bottomBarToggleAxes",
    "bottomBarToggleGrid",
    "bottomBarToggleViewportGizmo",
    "menuExportTemplate",
    "templateExportModal"
  ]) {
    assert.ok(shellIds.has(id), `${id} should be present in the editor shell`);
  }
});

test("viewport gizmo supports a runtime toggle and avoids pinned 3D chrome", async () => {
  const [appSource, chromeSource, overrideCss] = await Promise.all([
    readFile(new URL("../tools/scene-host/editor/js/editorApp.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/editor/js/editorChromeUi.js", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/editor/css/host-overrides.css", import.meta.url), "utf8")
  ]);

  assert.match(appSource, /viewportGizmoRuntimeOverride/);
  assert.match(appSource, /toggleViewportGizmoRuntime/);
  assert.match(chromeSource, /bottomBarToggleViewportGizmo/);
  assert.match(overrideCss, /not\(\.codeEditMode\).*#viewportGizmoOverlayRoot/);
  assert.match(overrideCss, /rightDockPinned.*#viewportGizmoOverlayRoot/s);
});
