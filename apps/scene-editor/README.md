# apps/scene-editor

ThreeJSON's scene editor as a React application, built **entirely on the published `@threejson/*`
packages** — no relative import into the monorepo, no dependency on `tools/scene-host` or the other
apps.

```
@threejson/editor-kit → the editor command layer (registry + editor.* command surface)
@threejson/react-ui   → SceneTreePanel (hierarchical outliner, shared with other apps)
@threejson/react      → useScenePlayer (viewport)
@threejson/host-kit   → scene URL resolution, scene-tree model, live-object lookup
threejson             → command registry / executor, engine
```

## Run

```bash
npm run dev      # http://localhost:5183
npm run build
```

## What this app is actually demonstrating

`src/useEditorApi.js` implements the `EditorApi` contract that editor-kit's command layer is written
against, backed by a live player runtime. That single seam is what makes the extracted command layer
usable: editor-kit knows *what* `editor.selection.set` / `editor.view.fit` / `editor.ingest` mean —
how to validate, parse, and dispatch them — but nothing about how any particular app stores
selection or renders. Supply the seam, get the whole command surface.

Selecting an object in the tree does **not** call `setState` directly; it dispatches
`editor.selection.set id=<threeJsonId>` through the registry, so the UI and the console take exactly
the same path.

> Command syntax note: core's micro-DSL is `key=value` with **no** leading dashes. The key is taken
> literally, so `--id=x` arrives as `args["--id"]` and the handler's `args.id` is undefined.

## Scope — read this before comparing to tools/scene-host/editor

"Step one" scope: load a scene, browse its addressable objects, select, and drive the editor through
the command layer. The original editor is ~16,000 lines across `editor/js` panels, and that UI is
app-local — only the command / AI / domain-edit-session logic was extracted into editor-kit. Not
reimplemented here:

- Texture upload/sampling controls, other viewport overlays
- AI sidebars (generate / adjust panels), CodeMirror JSON editing
- Recent scenes, presets, asset library, `.tjz`/GLB export

Present (each has its own section below): a scene-tree hierarchy (`@threejson/react-ui`'s
`SceneTreePanel`), a property inspector with a material panel (`src/PropertyInspector.jsx`), a
TransformControls gizmo, a viewport navigation gizmo, and IndexedDB session recovery.

### How editing and history actually work

Every inspector read is `object.get` and every write is `object.patch`, dispatched through the same
registry the console uses -- no private mutation path.

The non-obvious part is history. Core mutations apply to the **live scene** and do not write back to
the payload the scene was loaded from. Left alone, that makes history a lie: an "undo" that
re-ingests the untouched document looks like it worked, purely because it discards the runtime
edit -- and redo has no "after" state to restore. So each edit is bracketed:

1. `beginHistoryStep()` deep-clones the current document onto the undo stack (a clone, not the
   reference -- otherwise the patch edits the snapshot underneath you and undo becomes a no-op);
2. the patch runs;
3. `commitRuntimeToDocument()` re-serialises the scene so the document is authoritative again.

Undo therefore reloads the whole scene rather than inverting one property: coarser than the
original's `editorHistory` (677 lines of inverse operations), but honest about what it restores, and
redo works.

One visible consequence: the committed document is the *canonical* export, which is not
byte-identical to the authored source. For `portShow.json` the canonical form materialises one extra
tree node (`farewell-bgm`, an audio object, appears as a Mesh), so the tree reads 133 nodes on the
authored document and 134 after a commit. It converges after the first commit and does not grow with
further edits.

## Verified behavior

Loading `portShow.json` yields a 133-node tree (gizmos, helpers, lights and the engine's native-scene
wrapper filtered out) of which 65 are addressable by `threeJsonId`. Clicking `port-dispatch-center` dispatches
`editor.selection.set id=port-dispatch-center` and returns
`{"ok":true,"mode":"runtime","data":{"id":"port-dispatch-center"}}`, with the selection label and
list highlight updating from that result. `editor.selection.get` then round-trips the same id, and
`editor.view.fit` returns `{"ok":true,"data":{"target":"scene"}}`.


## Transform gizmo

Selecting an object attaches a TransformControls gizmo; the **Move / Rotate / Scale** toolbar
switches its mode. The gizmo is the one editor surface that mutates a live Object3D *directly*, so
`src/useTransformGizmo.js` folds that back into the same pipeline the inspector uses rather than
letting it bypass history:

- drag start disables orbit controls and calls `beginHistoryStep()` (one undo per drag);
- drag end runs `syncBoxModelTransformFromObject3D` — which writes the live transform into the
  object's **descriptor**, since the scene exporter reads the descriptor, not the live matrix
  (without this a drag renders but vanishes on the next reload) — then `commitRuntimeToDocument()`
  and a tree/inspector refresh.

So a gizmo drag and a typed `object.patch id=… path=position.x value=…` produce the same document
and the same undo entry. The gizmo helper is a live child of the scene, kept out of the outliner via
`SceneTreePanel`'s `extraRuntimeObjects`.

**Verified** end-to-end by driving the control's real `dragging-changed`/`mouseUp` events: dragging
`port-ground` moved its descriptor from `(0,-3,0)` to `(12,1,0)`, the committed document carried
`(12,1,0)`, and a single Undo reverted it to `(0,-3,0)`. The fold-back contract itself is pinned in
`tests/hostKitSmoke.test.mjs` against a real three Object3D; the scene tree stayed at 133 rows with
the gizmo attached, confirming the helper is hidden.


## Material panel

The inspector's material section edits colour, metalness, roughness, opacity, transparency and the
texture URL. Each field dispatches `material.patch` with a **single-key partial**, so the command
merges into the existing material rather than replacing it — changing colour never disturbs
roughness. Every edit goes through the same `beginHistoryStep → commit` bracket as transforms, so
each material field is its own independent, undoable step.

`material.patch` exists precisely so a material edit does not have to hand-build a
`{ material: { … } }` object.patch partial (and risk clobbering sibling fields by sending a stale
copy of them).

**Verified** in-browser end to end: editing roughness `0.9 → 0.25` left colour and textureUrl
untouched; a subsequent colour edit `#ffffff → #cc3344` then Undo reverted **only** the colour,
with roughness staying at `0.25`. The merge-not-replace property is pinned for DOM-free fields in
`tests/editorKitSmoke.test.mjs`; texture-field preservation is covered by the browser run, since
applying a texture needs a DOM loader Node has no access to.


## Session recovery

Edits autosave to IndexedDB (host-kit's `editorSessionIdb`, under `EDITOR_SESSION_RECOVERY_KEY`), so
a refresh or crash resumes where you left off. What's persisted is the **committed document** — the
same canonical payload `commitRuntimeToDocument` produces — plus the current selection, so a restore
is an ordinary `loadPayload` with no special rehydration path. Saves are debounced (a drag fires
many commits a second; the last state in the window wins) and a pending save is flushed on
`pagehide` so closing the tab does not lose the final edit.

On boot the app waits for the recovery read before deciding restore-vs-default, then shows a
dismissible banner. The banner offers only **Load sample scene** (discard the restored scene, clear
recovery, load the default) and dismiss — there is deliberately no "stop saving" action, because an
editor always wants recovery on.

**Verified** end to end: editing `position.y` to 42 persisted a v1 record carrying the edited
document and selection; a full page reload restored the scene (`y` still 42), re-selected
`port-ground`, and showed the banner; "Load sample scene" cleared the record and loaded the fresh
133-node sample. Where IndexedDB is absent the hook resolves `ready` with `saved: null`, so the app
falls back to the default scene instead of failing to boot.

## Viewport navigation gizmo

The corner widget (`src/useViewportGizmo.js`) whose faces/axes snap the camera to that orthographic
view — the feature that replaced the old per-axis "three views" cycling. The drawing logic is
host-kit's `viewportGizmoOverlay` (a thin wrapper over `three-viewport-gizmo`); the hook is the
React glue that recreates it against the live runtime on each scene load.

Two integration facts, both fixed/handled here:

- **host-kit's `viewportGizmoOverlay` bare-imported `three-viewport-gizmo` but host-kit never
  declared it.** `tools/scene-host` supplies it via an esm.sh importmap, so the gap was invisible
  there — but the module was unimportable in any bundler. It is now host-kit's *optional* peer
  dependency (only this one module needs it), and apps that use the gizmo install it directly.
- **Per-frame rendering:** the gizmo shares the scene renderer and must draw after the scene each
  frame. `tools/scene-host` gets that from the engine's `afterRender` scene-option, but that hook
  does not reach player-kit's internal render loop (the engine routes frame phases through a
  lifecycle bus that the running loop does not emit to in this path). So the gizmo is driven from
  its own `requestAnimationFrame`, the pattern `three-viewport-gizmo`'s own examples use; registered
  after the engine's loop, its callback runs after the scene render within each frame.

A **Gizmo** toolbar toggle shows/hides it — that is the component's own `enabled` parameter (false
disposes the overlay), wired to a localStorage-persisted state so the choice survives a refresh.

**Verification status:** the gizmo mounts stably (its 90×90 element is present continuously across a
fresh load) and is bound to the runtime's real camera and OrbitControls (`attachControls`); the
show/hide toggle is verified objectively — hiding removes the element (1→0), showing recreates it
(0→1), and the choice persists — which also proves the mount/dispose lifecycle is clean; a test pins
that host-kit's module now imports. The **click-to-snap and the on-canvas rendering are not
objectively verified** in this repo's headless preview: the WebGL back-buffer reads back cleared
(no `preserveDrawingBuffer`) so pixels can't be sampled, and the gizmo raycasts clicks against an
internal scene that synthetic pointer events can't reliably target. Those paths are
`three-viewport-gizmo`'s own tested behaviour, exercised identically by `tools/scene-host`.
