# Requirements assessment

## Asset-base convergence

`DEFAULT_CDN_ASSETS_BASE` is intentionally based on a pinned published asset version. A concrete CDN version is required for reproducible exported projects. The risk was not the literal itself; it was that template exporters had copied the literal independently. The source is now `core/util/assetsBase.js`, surfaced through `threejson/core`, with tests that verify exported templates and the vendored host-kit copy.

## Dynamic runtime requirements

The existing object registry correctly identifies actual `THREE.Object3D` instances, but it should not be abused for thousands of logical entities packed into one geometry. The existing descriptor mutation APIs are also intentionally descriptor-oriented, while high-frequency visualization state is a runtime overlay.

The new capabilities therefore need to provide:

1. A slot-backed, dense, generic geometry batch with stable logical IDs and local dirty-range GPU uploads.
2. A runtime-only entity registry for virtual entities, separate from the `threeJsonId` Object3D registry.
3. A coalescing, frame-bound commit scheduler that is inert until a host uses it.
4. Opt-in demand rendering, so static/delta-driven hosts can request a frame instead of holding a permanent render loop.

## Compatibility and risk controls

- Existing render loops remain continuous by default.
- Existing object registry and descriptor semantics stay unchanged.
- All APIs are additive and optional.
- The dynamic batch does not prescribe shaders, colors, node shapes, edge meaning, or source-of-truth persistence.
- Tests run without a WebGL context; they validate slot allocation, dense removal, dirty-range commits, scheduling, entity ownership, and demand-loop behavior.

## Acceptance criteria

- No exported template contains an independently maintained asset-version source.
- A host can update one logical entity without reconstructing the entire geometry.
- Removing an entity preserves dense draw ranges and rewires only the moved slot.
- Multiple scene runtime contexts do not share virtual-entity or commit-scheduler state.
- Existing continuous rendering behavior is unchanged when the new demand mode is absent.
