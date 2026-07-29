# apps/scene-shower

ThreeJSON's live JSON playground as a React application, built **entirely on the published
`@threejson/*` packages** — no relative import into the monorepo, no dependency on
`tools/scene-host` or the other apps.

```
@threejson/react    → useScenePlayer (viewport + state), useHostI18n (locale)
@threejson/react-ui → MeshExportDialog (format picker + warnings report)
@threejson/host-kit → demo-catalog / scene URL resolution, HTML template export,
                      friendly ⇄ standard conversion, mesh export
threejson           → authoring-view detection
```

This app is the only consumer so far of host-kit's `templateExportBuilders`, and the second
consumer of `meshExport` / `@threejson/react-ui` — which is what proved those were worth extracting
rather than leaving in the app they came from.

## Run

```bash
npm run dev      # http://localhost:5181
npm run build
```

## Scope

Demo catalog (loaded from the `@threejson/assets` CDN manifest), an editable JSON pane with live
(debounced) or manual render, JSON pretty-format, friendly ⇄ standard payload conversion, fit-view,
HTML template export, native-JSON export, mesh export (GLB/GLTF/OBJ/STL/PLY/USDZ), and locale
switching.

**Not** reimplemented from `tools/scene-host/shower` yet: the viewport navigation gizmo (host-kit's `viewportGizmoOverlay`), the scene-tree tab,
axes/grid/gizmo overlays, and theme switching. The "open in editor" action is implemented as an
explicit `window.open()` + `postMessage` handshake rather than the legacy localStorage bridge.

## Localization note

The shared host-kit i18n catalogs have no `shower.*` keys, and host-kit's `t()` returns the English
fallback for a missing key regardless of locale. So — like the original shower — this app keeps its
own small label table (`src/labels.js`) and uses `useHostI18n()` only for the resolved locale.

Components from `@threejson/react-ui` render *their* strings through host-kit's `t()`. That used to
need an explicit `setHostLocale()` here, and omitting it left the shared dialog showing key-derived
text ("Title" instead of "Export Third-Party Model") — `@threejson/react` now loads the catalog on
first use, so this app just reads the resolved locale.

## Verified behavior

The CDN manifest yields 19 sections / 59 examples; the first auto-loads and renders. Converting the
minimal friendly-JSON example (1016 chars) to standard form yields a 1817-char document with a
canonical `objectList`, converting back returns the `sceneConfig`/`worldInfo` authoring shape, and
the viewport re-renders each conversion without error. Native-JSON export downloads exactly that
canonical document. Mesh export of the loaded demo produced a 2.4 KB `.glb` plus one genuine
warning (helper nodes excluded from export), and the shared dialog re-localises live while open.
