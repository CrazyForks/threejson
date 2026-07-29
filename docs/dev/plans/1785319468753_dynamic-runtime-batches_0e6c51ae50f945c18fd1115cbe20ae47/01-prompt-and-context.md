# Prompt and context

- Date: 2026-07-29 (Asia/Shanghai)
- Goal: complete the pending `@threejson/assets` CDN-base convergence work, then add generic ThreeJSON primitives for high-frequency dynamic visualizations.
- Downstream motivation: BlueBox needs a continuously changing graph viewport with many logical nodes and edges. It must update GPU buffers locally, batch updates once per animation frame, and keep stable virtual IDs without creating one `Object3D` per logical entity.
- Scope boundary: this work adds reusable ThreeJSON Core mechanisms only. It must not import BlueBox, mention BlueBox in public APIs, embed graph/AI/consciousness semantics, or add host UI behavior to Core.
- Explicit non-goals: modify `servertmp/`; alter independent app products; publish npm packages; replace existing descriptor/object mutation APIs; turn ThreeJSON into an ECS or network synchronization framework.

## Human review

- Reviewer: Tianhe (repository owner)
- Review date: 2026-07-29
- Conclusion: approved in the user conversation before implementation. The owner explicitly requested generic capabilities only and preservation of the one-way dependency rules documented by ThreeJSON.
