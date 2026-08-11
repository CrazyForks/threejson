# @threejson/react-ui

Ready-made, styled React components for ThreeJSON scene-host apps.

Separate from [`@threejson/react`](../react) by design: that package is the **headless** binding
layer (hooks + a minimal `SceneViewport`) and carries no CSS or visual opinions. Consumers who only
want `useScenePlayer` should not be forced to take a design system with it. This package is where
opinionated, pre-built UI lives.

## Install

```bash
npm install @threejson/react-ui @threejson/react @threejson/host-kit threejson react
```

## Usage

```jsx
import { MeshExportDialog } from "@threejson/react-ui/mesh-export";
import "@threejson/react-ui/styles.css"; // optional dark default

<MeshExportDialog
  getSceneSnapshot={player.getSnapshot}
  onClose={() => setOpen(false)}
/>
```

Use `@threejson/react-ui/scene-tree` for `SceneTreePanel`. The package root remains an aggregate compatibility entry.

## Localisation

Components here render their strings through host-kit's `t()`. The catalog loads automatically the
first time any `useHostI18n()` runs, so there is nothing to set up — call `setHostLocale(tag)` only
to *change* locale.

This used to require an explicit `setHostLocale()` at app boot, and forgetting it failed silently:
host-kit's `t()` falls back to key-derived text ("Title" from `threebox.meshExport.title`) rather
than to the supplied fallback, so the UI rendered plausible nonsense instead of erroring. Two of the
three apps here hit it. `@threejson/react` now initialises on first use.

### `<MeshExportDialog />`

Format picker (GLB / GLTF / OBJ / STL / PLY / USDZ) → export → post-export warnings report. The
export itself is host-kit's `exportSceneMeshToFile`; this is only the UI. Warnings keep the dialog
open on a report screen rather than closing silently, because the file downloaded but lost something
in conversion and the user should see that before shipping it.

| Prop | Type | Notes |
|---|---|---|
| `getSceneSnapshot` | `() => { scene, renderer, currentLabel }` | Called at export time — e.g. `useScenePlayer`'s `getSnapshot`. |
| `onClose` | `() => void` | |
| `onExported` | `({ fileName, warnings }) => void` | Optional hook for toasts/telemetry. |

### `<SceneTreePanel />`

A collapsible outline of the live scene graph with selection. The *model* — which objects to hide
(transform gizmos, box-edge highlights, grid/axes helpers, the engine's native-scene wrapper) and
how to resolve a row back to a live object — lives in host-kit's `sceneTreeModel`; this is the
rendering half.

```jsx
<SceneTreePanel
  scene={player.getSnapshot()?.scene}
  revision={sceneVersion}
  selectedKey={selectedId}
  onSelect={(node) => select(node.threeJsonId)}
/>
```

| Prop | Type | Notes |
|---|---|---|
| `scene` | `Object3D \| null` | Live root. Renders an empty state when null. |
| `revision` | `number \| string` | **Bump to rebuild.** The graph is mutated in place, which React cannot observe. |
| `selectedKey` | `string` | Controlled selection: `threeJsonId`, falling back to `uuid`. |
| `onSelect` | `(node) => void` | `node.object` is the live Object3D. |
| `extraRuntimeObjects` | `any[]` | App-owned gizmos to hide, matched by identity. |
| `hideLights` | `boolean` | Defaults to `true`. |

Rows key off `threeJsonId` (stable across reloads) and fall back to `uuid`. Note that objects
without an authored id still render but cannot be addressed by command-layer ops — check
`node.threeJsonId` before dispatching.

`revision` is worth dwelling on: pass a value that changes when the scene has *finished* loading,
not when a load has been *requested*. Keying it to a payload/state change that publishes before the
load resolves rebuilds the tree against the old scene and leaves it empty until something else
happens to invalidate it.

## Styling

Components emit `tjUi-*` class names and nothing else. Either define those classes yourself, or
import the bundled sheet — every value in it is driven by a CSS custom property (`--chrome`,
`--line`, `--text`, `--muted`, `--accent`), so a host app can retheme by setting those instead of
overriding rules.

## No build step

Authored with `createElement` rather than JSX so the package ships raw ESM with no compile pipeline,
matching the other `@threejson/*` kits. Invisible to consumers — you still write `<MeshExportDialog />`.

## Status

Alpha. Components are added here only once a second app genuinely needs them, rather than
speculatively.
