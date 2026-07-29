import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  createDynamicPointBatch,
  createDynamicSegmentBatch
} from "../core/runtime/dynamicGeometryBatch.js";
import { createFrameCommitScheduler } from "../core/runtime/frameCommitScheduler.js";
import {
  createRuntimeEntityRegistryStore,
  getRuntimeEntity,
  listRuntimeEntities,
  registerRuntimeEntity
} from "../core/runtime/runtimeEntityRegistry.js";
import { attachRuntimeContext, createRuntimeContext } from "../core/runtime/runtimeContext.js";
import { createRenderLoop } from "../core/handler/frameLoopHandler.js";

test("dynamic point batch updates dense slots and only commits dirty ranges after its first upload", () => {
  const batch = createDynamicPointBatch({
    capacity: 2,
    attributes: {
      position: { itemSize: 3, defaultValue: [0, 0, 0] },
      color: { itemSize: 3, defaultValue: [1, 1, 1] },
      activation: { itemSize: 1, defaultValue: 0 }
    }
  });

  batch.set("first", { position: [1, 2, 3], activation: 0.5 });
  assert.equal(batch.entityCount, 1);
  assert.equal(batch.geometry.drawRange.count, 1);
  batch.commit();

  batch.patch("first", { activation: 0.75 });
  const commit = batch.commit();
  assert.deepEqual(commit.attributeRanges, [{ name: "activation", start: 0, count: 1 }]);
  assert.equal(batch.getAttribute("activation").array[0], 0.75);

  batch.set("second", { position: [4, 5, 6], color: [0.2, 0.3, 0.4] });
  batch.remove("first");
  assert.equal(batch.entityCount, 1);
  assert.equal(batch.getSlot("second"), 0);
  assert.deepEqual(Array.from(batch.getAttribute("position").array.slice(0, 3)), [4, 5, 6]);
  assert.equal(batch.geometry.drawRange.count, 1);

  batch.dispose();
  assert.equal(batch.disposed, true);
});

test("set() replaces omitted attributes with defaults while patch() leaves them untouched", () => {
  const batch = createDynamicPointBatch({
    capacity: 2,
    attributes: {
      position: { itemSize: 3, defaultValue: [0, 0, 0] },
      color: { itemSize: 3, defaultValue: [1, 1, 1] }
    }
  });
  const colorOf = (slot) => Array.from(batch.getAttribute("color").array.slice(slot * 3, slot * 3 + 3));

  batch.set("a", { position: [1, 2, 3], color: [0.1, 0.2, 0.3] });
  assert.deepEqual(colorOf(0), [0.1, 0.2, 0.3].map(Math.fround));

  // patch() is a merge: the omitted `color` keeps its current value.
  batch.patch("a", { position: [9, 9, 9] });
  assert.deepEqual(colorOf(0), [0.1, 0.2, 0.3].map(Math.fround));

  // set() is a replace: the omitted `color` falls back to its schema default.
  batch.set("a", { position: [4, 5, 6] });
  assert.deepEqual(colorOf(0), [1, 1, 1]);
  assert.deepEqual(Array.from(batch.getAttribute("position").array.slice(0, 3)), [4, 5, 6]);
});

test("a slot reused after swap-removal never inherits the previous entity's values", () => {
  const batch = createDynamicPointBatch({
    capacity: 2,
    attributes: {
      position: { itemSize: 3, defaultValue: [0, 0, 0] },
      color: { itemSize: 3, defaultValue: [1, 1, 1] }
    }
  });
  batch.set("gone", { position: [7, 7, 7], color: [0.5, 0.5, 0.5] });
  batch.remove("gone");

  // Even via patch() (merge semantics), a freshly allocated slot must start from defaults rather
  // than the removed entity's leftover bytes.
  batch.patch("fresh", { position: [1, 1, 1] });
  assert.equal(batch.getSlot("fresh"), 0);
  assert.deepEqual(Array.from(batch.getAttribute("color").array.slice(0, 3)), [1, 1, 1]);
});

test("dynamic segment batch supports two independent vertices per logical entity and capacity growth", () => {
  const batch = createDynamicSegmentBatch({
    capacity: 1,
    attributes: {
      position: { itemSize: 3, defaultValue: 0 },
      color: { itemSize: 3, defaultValue: [1, 1, 1] }
    }
  });
  batch.set("edge-a", { position: [0, 0, 0, 1, 2, 3] });
  batch.set("edge-b", { position: [4, 5, 6, 7, 8, 9] });
  assert.equal(batch.capacity, 2);
  assert.equal(batch.geometry.drawRange.count, 4);
  assert.deepEqual(Array.from(batch.getAttribute("position").array.slice(6, 12)), [4, 5, 6, 7, 8, 9]);
});

test("runtime entity registry separates virtual entities from scene Object3D identity and isolates contexts", () => {
  const directStore = createRuntimeEntityRegistryStore();
  directStore.register({ id: "slot-1", kind: "logical", handle: { slot: 3 } });
  assert.equal(directStore.get("slot-1").handle.slot, 3);

  const firstContext = createRuntimeContext();
  const secondContext = createRuntimeContext();
  const firstScene = new THREE.Scene();
  const secondScene = new THREE.Scene();
  attachRuntimeContext(firstScene, firstContext);
  attachRuntimeContext(secondScene, secondContext);

  registerRuntimeEntity({ id: "shared-name", ownerId: "layer-a", kind: "vertex" }, firstScene);
  registerRuntimeEntity({ id: "shared-name", ownerId: "layer-b", kind: "vertex" }, secondScene);
  assert.equal(getRuntimeEntity("shared-name", firstScene).ownerId, "layer-a");
  assert.equal(getRuntimeEntity("shared-name", secondScene).ownerId, "layer-b");
  assert.equal(listRuntimeEntities({ ownerId: "layer-a" }, firstScene).length, 1);
  assert.equal(listRuntimeEntities({ ownerId: "layer-a" }, secondScene).length, 0);

  firstContext.dispose();
  secondContext.dispose();
});

test("frame commit scheduler coalesces keyed jobs to one frame", () => {
  let nextCallback = null;
  let nextHandle = 0;
  const scheduler = createFrameCommitScheduler({
    requestFrame(callback) {
      nextCallback = callback;
      nextHandle += 1;
      return nextHandle;
    },
    cancelFrame() {}
  });
  const calls = [];
  scheduler.enqueue("layer", () => calls.push("old"));
  scheduler.enqueue("layer", () => calls.push("new"));
  scheduler.enqueue("overlay", () => calls.push("overlay"));
  assert.deepEqual(scheduler.getPendingKeys(), ["layer", "overlay"]);
  const result = nextCallback(123);
  assert.deepEqual(calls, ["new", "overlay"]);
  assert.equal(result.executed, 2);
  assert.equal(scheduler.isScheduled, false);
});

test("demand render loop renders an initial frame and explicit invalidations without creating a permanent loop", () => {
  const callbacks = new Map();
  let nextHandle = 0;
  let renderCount = 0;
  const loop = createRenderLoop({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    renderer: {
      render() {
        renderCount += 1;
      },
      domElement: { clientWidth: 10, clientHeight: 10, width: 10, height: 10 },
      getPixelRatio() {
        return 1;
      }
    },
    config: { scheduleMode: "demand", autoResize: false, firstAutoResize: false, updateAnimations: false },
    requestFrame(callback) {
      nextHandle += 1;
      callbacks.set(nextHandle, callback);
      return nextHandle;
    },
    cancelFrame(handle) {
      callbacks.delete(handle);
    }
  });

  loop.start();
  assert.equal(callbacks.size, 1);
  const runScheduled = (handle, now) => {
    const callback = callbacks.get(handle);
    callbacks.delete(handle);
    callback(now);
  };
  runScheduled(1, 10);
  assert.equal(renderCount, 1);
  assert.equal(callbacks.size, 0);
  assert.equal(loop.invalidate(), true);
  runScheduled(2, 20);
  assert.equal(renderCount, 2);
  assert.equal(callbacks.size, 0);
  loop.stop();
});
