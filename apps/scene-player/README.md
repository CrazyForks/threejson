# apps/scene-player

ThreeJSON scene player as a React application, built **entirely on the published `@threejson/*`
packages**. It has no relative import into the monorepo and no dependency on `tools/scene-host` or
on the other apps.

That constraint is the point: this app is the composition proof for the packages extraction. If it
runs, the packages are genuinely self-contained and usable by an outside consumer.

```
@threejson/react      → useScenePlayer / useHostI18n / usePlayerSettings
@threejson/react-ui   → MeshExportDialog (shared with apps/scene-shower)
@threejson/player-kit → scene-file classification (and the runtime, via @threejson/react)
@threejson/host-kit   → settings store, settings-derived default scene URL, i18n catalogs
threejson             → the engine, pulled in transitively by the kits
```

## Run

```bash
npm run dev      # http://localhost:5180
npm run build
npm run preview
```

Dependencies resolve through the repo's npm workspaces, so no publishing step is needed for local
development — the `@threejson/*` packages are symlinked from `packages/`.

## Scope

Implemented: scene loading (URL / file / settings-derived default), **playlist** (multi-add, switch,
prev/next, right-click menu with play / copy path / remove, clear, IndexedDB-backed file entries and
a localStorage manifest that restores on reload), transport (play / pause / stop), fit view,
volume + mute, a settings dialog (target FPS, antialias, low-FPS mode, auto-rotate, restore-playlist,
remember-volume, asset gateway URL, restore-defaults), locale switching, and loading / idle / error
states.

Also implemented: a "⋯" menu with **native Three.js JSON load**, **third-party mesh export**
(GLB/GLTF/OBJ/STL/PLY/USDZ with a post-export warnings report) and fullscreen, plus the
**editor-preview bridge** — a trusted opener uses `scenePreview=1`, `bridgeSession`, and an explicit
`openerOrigin` to make this app a live preview target. The receiver verifies the origin, opener
window, protocol version, and session before accepting a scene; it then shows an "Editor preview"
badge and suppresses default-scene seeding so the pushed scene is never overwritten.

**Not** reimplemented from `tools/scene-host/player` yet: template export and the
immersive auto-hiding chrome. `tools/scene-host/player` remains the feature-complete production
baseline until this app reaches parity.

## Playlist lives in the package, its UI lives here

The playlist **model** — entries, current pointer, localStorage manifest, IndexedDB blobs, restore —
is `createPlaylistStore` in `@threejson/player-kit`, surfaced to React by `usePlaylist` in
`@threejson/react`. Only the list rendering and context menu are app code. The store deliberately
does *not* load scenes: `activate(index)` moves the pointer and returns the entry, and this app's
`onActivate` decides to call `loadFromUrl` / `loadFromFile`. That keeps the playlist reusable for a
queue widget or batch job that owns no viewport.

It uses its own storage namespace (`threejson.apps.scenePlayer.playlist.*`), so running this app
cannot corrupt the playlist saved by `tools/scene-host/player` on the same origin.

## Verified behavior

The default scene (`portShow.json` from the `@threejson/assets` CDN) loads as a live scene of 58 root
children / 115 meshes in a correctly-sized WebGL canvas, with the title driven by the runtime's
`title-change` event and the UI auto-localizing to the browser locale.

Playlist round-trip: adding `json/roomShow.json` loads it and marks it active (⏮ enabled, ⏭
disabled); ⏮ returns to `portShow.json` and flips those states. After a full page reload both entries
rehydrate from storage, the previously-current one auto-loads, and the default-scene seeding
correctly does **not** re-run (still exactly 2 rows).

Mesh export: the dialog renders all six formats from host-kit's shared `MESH_EXPORT_FORMATS`,
localized through host-kit's i18n (`GLB（推荐）`, `USDZ（AR）`, …). Exporting the 115-mesh port scene
to GLB completes and surfaces 19 real exporter warnings — skipped gizmo/helper nodes, and textures
omitted because the CDN images are cross-origin — proving the extracted export path works end to end
rather than just rendering a dialog.
