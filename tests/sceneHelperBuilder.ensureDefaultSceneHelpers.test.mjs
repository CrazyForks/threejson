import test from "node:test";
import assert from "node:assert/strict";
import { ensureDefaultSceneHelpers } from "../core/builder/sceneHelperBuilder.js";

test("ensureDefaultSceneHelpers injects visible grid+axes when none specified", () => {
  const payload = {
    worldInfo: {
      boxModelList: [
        { objType: "box", geometry: { width: 10, height: 10, depth: 10 }, position: { x: 0, y: 0, z: 0 } }
      ]
    }
  };
  ensureDefaultSceneHelpers(payload);
  assert.equal(payload.sceneConfig.helpers.grid.visible, true);
  assert.equal(payload.sceneConfig.helpers.axes.visible, true);
});

test("ensureDefaultSceneHelpers keeps grid cell size fixed while scaling divisions with extent", () => {
  const small = { worldInfo: { boxModelList: [{ objType: "box", geometry: { width: 10, height: 10, depth: 10 }, position: { x: 0, y: 0, z: 0 } }] } };
  const big = { worldInfo: { boxModelList: [{ objType: "box", geometry: { width: 400, height: 10, depth: 400 }, position: { x: 0, y: 0, z: 0 } }] } };
  ensureDefaultSceneHelpers(small);
  ensureDefaultSceneHelpers(big);
  const smallGrid = small.sceneConfig.helpers.grid;
  const bigGrid = big.sceneConfig.helpers.grid;
  assert.equal(smallGrid.size / smallGrid.divisions, bigGrid.size / bigGrid.divisions);
  assert.ok(bigGrid.size > smallGrid.size, "bigger scene should get a bigger grid");
});

test("ensureDefaultSceneHelpers leaves an explicit user-authored helpers config untouched", () => {
  const payload = {
    sceneConfig: { helpers: { grid: { visible: false } } },
    worldInfo: {}
  };
  const before = JSON.stringify(payload.sceneConfig.helpers);
  ensureDefaultSceneHelpers(payload);
  assert.equal(JSON.stringify(payload.sceneConfig.helpers), before);
});

test("ensureDefaultSceneHelpers respects legacy top-level gridHelper/axesHelper aliases", () => {
  const payload = {
    sceneConfig: { gridHelper: { visible: false, size: 5 } },
    worldInfo: {}
  };
  ensureDefaultSceneHelpers(payload);
  assert.equal(payload.sceneConfig.helpers, undefined, "should not inject sceneConfig.helpers when a legacy alias is already present");
});
