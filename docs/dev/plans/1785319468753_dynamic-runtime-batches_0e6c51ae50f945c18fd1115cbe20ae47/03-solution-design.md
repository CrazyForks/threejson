# Solution design

## Public Core mechanisms

### Dynamic geometry batch

`createDynamicGeometryBatch()` owns one `BufferGeometry` and an ordered dense slot table. A caller supplies a generic attribute schema and `verticesPerEntity`. Logical entity IDs map to slots; `set`, `patch`, and `remove` update typed arrays in place. `commit()` marks only the accumulated attribute ranges for GPU upload. Capacity growth replaces the relevant attributes and performs one full upload.

Convenience constructors create a one-vertex point batch and a two-vertex segment batch. They are data structures, not a scene format or a domain type; a host chooses materials, shaders, parent objects, and visual semantics.

### Runtime entity registry

`RuntimeEntityRegistry` is per `RuntimeContext` and stores generic logical records (`id`, `ownerId`, `kind`, `handle`, and metadata). It is intentionally distinct from `objectRegistry`: a virtual entity need not be an `Object3D`, and a host may associate it with a dynamic-batch slot.

### Frame commit scheduler

`FrameCommitScheduler` coalesces jobs by key and runs them once at the next animation frame (or injected scheduler). It is an explicit host tool; it does not schedule descriptor deployment, network input, or business actions.

### Demand rendering

`createRenderLoop()` gains an opt-in `scheduleMode: "demand"`. Continuous mode remains the default. In demand mode `start()` schedules an initial render, `invalidate()` schedules one subsequent frame, resize invalidates, and controls that emit `change` invalidate. Hosts with continuous animation should retain the default continuous mode.

## Documentation and packaging

- Public API documentation will state the runtime-overlay boundary and recommended use for high-rate visualizations.
- `threejson/core` will export the new APIs.
- No package is published in this work. After verification, the owner will publish the root `threejson` package; no separate package is needed for these Core APIs.

## Test plan

- `assetsBase.test.mjs` plus `templateExportAssetsBase.test.mjs` guard the asset URL source.
- A new runtime test exercises dynamic slot allocation, updates, removal, growth, dirty ranges, entities, scheduler coalescing, and demand rendering using fakes rather than a browser/WebGL context.
