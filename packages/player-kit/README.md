# @threejson/player-kit

Embeddable ThreeJSON scene-player runtime. Mount to a `<canvas>`, load scenes (from URL, `File`,
parsed payload, or `.tjz` archive), control transport (play/pause), audio (volume/mute), highlight,
fit-to-view, and the editor-preview handshake — without pulling in a full player *application*
(top menu bar, playlist list UI, settings modal, immersive-chrome edge behavior).

Built on [`@threejson/host-kit`](../host-kit) and the [`threejson`](https://www.npmjs.com/package/threejson)
engine. Extracted from [`tools/scene-host/player`](../../tools/scene-host/player), which stays the
stable production baseline and is **not** yet changed to depend on this package.

## Install

```bash
npm install @threejson/player-kit @threejson/host-kit threejson three
```

All four are peer dependencies (`threejson`/`@threejson/host-kit`/`three` for `player-kit`; bring
compatible versions).

## Usage

```js
import { createPlayerRuntime } from "@threejson/player-kit/js/createPlayerRuntime.js";

const player = createPlayerRuntime({
  canvas: document.getElementById("canvas"),
  canvasWrap: document.getElementById("canvasWrap"), // optional; used for layout sizing
  onEvent(type, detail) {
    // "loading" | "loading-message" | "error" | "transport-change" | "title-change" | "volume-change"
    if (type === "title-change") document.title = detail.label;
  }
});

await player.loadFromUrl("json/portShow.json"); // resolved against @threejson/assets CDN by default
player.pause();
player.play();
player.setVolume(0.5);
player.dispose();
```

### What the caller still owns

`player-kit` is deliberately **headless except for the canvas it renders to**. It never reads a
specific DOM element ID for loading text, transport buttons, or the scene title — it reports those
through `onEvent(type, detail)` so any UI (vanilla, React, …) can render them. What stays in the
consuming app:

- **Playlist**: the array of scenes + its list/context-menu UI + localStorage manifest persistence.
  (The raw IndexedDB blob primitives are exported from
  [`js/playerPlaylistIdb.js`](js/playerPlaylistIdb.js) since any playlist layer needs them, but the
  playlist *logic* is app-level.)
- **Top menu bar**, **settings modal**, **immersive chrome** (edge-hover auto-hide).

### Editor-preview integration

[`js/playerEditorPreviewBridge.js`](js/playerEditorPreviewBridge.js) implements the
`window.postMessage`-based `scenePreviewProtocol` handshake (a player opened by the editor with
`?editorPreview=1` receives scene payloads live). Wire its `applyPreviewPayload` to
`player.loadFromPayload`.

## Status

Alpha. Boundaries and exports may change before a stable 0.1.0. Consumed by `apps/scene-player`
(and transitively by `apps/scene-shower` / `threebox` / `scene-editor` via `@threejson/react`).
`tools/scene-host/player` deliberately stays on its own copy — it is both the production baseline
and the reference the app is written against — until the app can replace it outright.
