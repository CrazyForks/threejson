[中文](../zh/dynamic-runtime-batches.md) | [English](./dynamic-runtime-batches.md)

# Dynamic runtime batches

ThreeJSON's normal object and descriptor APIs are designed for scene assembly and
low-frequency authoring updates. Use the APIs in this document when an application
has many *logical* visual entities that change frequently, such as telemetry points,
links, traces, or simulation state.

This is a runtime overlay. It does not change the JSON descriptor, does not create one
`Object3D` per logical entity, and does not impose a persistence model.

## Slot-backed geometry

```js
import * as THREE from "three";
import {
  createDynamicPointBatch,
  createDynamicSegmentBatch,
  createFrameCommitScheduler
} from "threejson/core";

const nodes = createDynamicPointBatch({
  capacity: 512,
  attributes: {
    position: { itemSize: 3, defaultValue: [0, 0, 0] },
    color: { itemSize: 3, defaultValue: [0.4, 0.9, 0.9] },
    size: { itemSize: 1, defaultValue: 4 },
    activation: { itemSize: 1, defaultValue: 0 }
  }
});

const edges = createDynamicSegmentBatch({
  capacity: 1024,
  attributes: {
    position: { itemSize: 3, defaultValue: 0 },
    color: { itemSize: 3, defaultValue: [0.3, 0.8, 0.8] },
    opacity: { itemSize: 1, defaultValue: 0.5 }
  }
});

const pointObject = new THREE.Points(nodes.geometry, pointMaterial);
const lineObject = new THREE.LineSegments(edges.geometry, lineMaterial);
scene.add(pointObject, lineObject);
```

`set(id, values)` allocates or replaces an entity: attributes you omit are reset to
their schema defaults. `patch(id, values)` changes only the supplied attributes and
leaves the rest as they are — though a patch that allocates a new entity still writes
defaults first, so a fresh slot never inherits leftovers from a swap-removed
predecessor. `remove(id)` uses dense swap removal, so draw ranges remain compact and a
removed slot never leaves a visible hole.

For a one-vertex point entity, `position` is `[x, y, z]`. For a two-vertex segment
entity it is `[x0, y0, z0, x1, y1, z1]`. An attribute value matching one vertex's
`itemSize` is repeated for every vertex of that logical entity.

Call `commit()` after a group of changes. The batch marks only accumulated changed
attribute ranges for GPU upload. A capacity growth is intentionally a full upload,
but grows geometrically and should be infrequent.

Growing also replaces each `BufferAttribute` with a larger one; the superseded GPU
buffer is only released once the renderer drops the old attribute (at the latest on
`geometry.dispose()`). That is harmless at normal frequencies, but for large,
churn-heavy batches prefer sizing `capacity` up front to your expected peak so growth
does not recur on a hot path.

## Frame coalescing and demand rendering

Use one scheduler per viewport/layer group to merge many incoming updates into one
frame. This does not replace application input queues or networking; it only bounds
GPU commits and visual invalidation.

```js
const commits = createFrameCommitScheduler();

function applyNodeDelta(id, delta) {
  nodes.patch(id, delta);
  commits.enqueue("nodes", () => {
    nodes.commit();
    runtime.invalidate();
  });
}
```

For a static or delta-driven viewport, opt into demand rendering:

```js
const runtime = createSceneRuntime({
  canvas,
  config: {
    renderLoop: { scheduleMode: "demand", updateAnimations: false }
  }
});
runtime.start(); // renders the first frame
```

`runtime.invalidate()` schedules at most one additional frame. The default remains
`scheduleMode: "continuous"`; use it for time-based animation, particle simulation,
or controls that need a permanent frame loop.

## Runtime entity registry

Actual `Object3D` values continue to use `threeJsonId` and `objectRegistry`. Logical
entities in a shared geometry use the separate runtime entity registry instead:

```js
import {
  createRuntimeContext,
  createSceneRuntime,
  registerRuntimeEntity
} from "threejson/core";

const runtimeContext = createRuntimeContext();
const runtime = createSceneRuntime({ canvas, runtimeContext });

const slot = nodes.set("node:42", { position: [1, 2, 3] });
registerRuntimeEntity({
  id: "node:42",
  ownerId: "node-layer",
  kind: "point",
  handle: { batch: "nodes", slot }
}, runtime.scene);
```

`RuntimeEntityRegistry` is per `RuntimeContext`. It stores generic IDs, optional
owners/kinds, opaque handles, and metadata. It neither defines an application's
meaning for those records nor writes them into scene JSON.
