import assert from "node:assert/strict";
import { test } from "node:test";

// Imports every packages/player-kit module through its published-style specifier
// ("@threejson/player-kit/js/*.js"), so this also proves the workspace links (player-kit ->
// @threejson/host-kit -> threejson) and the exports maps resolve end to end — the same path a real
// consumer of the published packages goes through. Full runtime instantiation needs a canvas +
// WebGL, so this covers module resolution, pure helpers, and the argument guard rather than a live
// render.

test("createPlayerRuntime module exports the runtime factory + filename helpers", async () => {
  const mod = await import("@threejson/player-kit/js/createPlayerRuntime.js");
  assert.equal(typeof mod.createPlayerRuntime, "function");
  assert.equal(typeof mod.isTjzSceneFileName, "function");
  assert.equal(typeof mod.isJsonSceneFileName, "function");
  assert.equal(typeof mod.isSupportedSceneFileName, "function");
});

test("scene filename helpers classify by extension", async () => {
  const { isTjzSceneFileName, isJsonSceneFileName, isSupportedSceneFileName } = await import(
    "@threejson/player-kit/js/createPlayerRuntime.js"
  );
  assert.equal(isTjzSceneFileName("scene.tjz"), true);
  assert.equal(isTjzSceneFileName("scene.json"), false);
  assert.equal(isJsonSceneFileName("scene.json"), true);
  assert.equal(isJsonSceneFileName("scene.threejson"), true);
  assert.equal(isJsonSceneFileName("scene.tjson"), true);
  assert.equal(isJsonSceneFileName("scene.tjz"), false);
  assert.equal(isSupportedSceneFileName("scene.tjz"), true);
  assert.equal(isSupportedSceneFileName("scene.json"), true);
  assert.equal(isSupportedSceneFileName("scene.png"), false);
});

test("createPlayerRuntime requires a canvas", async () => {
  const { createPlayerRuntime } = await import("@threejson/player-kit/js/createPlayerRuntime.js");
  // Pass an explicit sysConfig so the createPlayerSysConfig() default (which reads window.innerWidth)
  // doesn't run under Node — we're exercising player-kit's own guard, not host-kit's sysConfig.
  assert.throws(() => createPlayerRuntime({ sysConfig: { initFlags: {} } }), /canvas is required/);
});

test("player helper modules resolve through @threejson/host-kit", async () => {
  const interaction = await import("@threejson/player-kit/js/playerSceneInteraction.js");
  assert.equal(typeof interaction.createPlayerSceneInteraction, "function");
  const bridge = await import("@threejson/player-kit/js/playerEditorPreviewBridge.js");
  assert.equal(typeof bridge.createPlayerEditorPreviewBridge, "function");
  const highlight = await import("@threejson/player-kit/js/playerHighlight.js");
  assert.equal(typeof highlight.createPlayerHighlightController, "function");
  assert.equal(typeof highlight.getPlayerHighlightChannelOptions, "function");
});

test("playerPlaylistIdb exposes blob-store primitives", async () => {
  const idb = await import("@threejson/player-kit/js/playerPlaylistIdb.js");
  assert.equal(typeof idb.playerPlaylistIdbPut, "function");
  assert.equal(typeof idb.playerPlaylistIdbGet, "function");
  assert.equal(typeof idb.playerPlaylistIdbDelete, "function");
  assert.equal(typeof idb.playerPlaylistIdbClear, "function");
});

test("getPlayerHighlightChannelOptions falls back to default channel colors", async () => {
  const { getPlayerHighlightChannelOptions } = await import("@threejson/player-kit/js/playerHighlight.js");
  const opts = getPlayerHighlightChannelOptions(null);
  assert.equal(opts.info.visibleEdgeColor, "#FFFFFF");
  assert.equal(opts.locate.visibleEdgeColor, "#E6A800");
  assert.equal(opts.alarm.visibleEdgeColor, "#DC3A2F");
});

test("createPlaylistStore exposes a headless list model with a useSyncExternalStore-shaped API", async () => {
  const { createPlaylistStore, fileNameFromUrl } = await import(
    "@threejson/player-kit/js/createPlaylistStore.js"
  );
  assert.equal(fileNameFromUrl("https://example.com/a/b/scene.json"), "scene.json");
  assert.equal(fileNameFromUrl("json/portShow.json"), "portShow.json");

  const store = createPlaylistStore({ storagePrefix: "test.playlist" });
  for (const fn of ["subscribe", "getSnapshot", "addUrl", "addFile", "activate", "removeAt", "clear", "restore"]) {
    assert.equal(typeof store[fn], "function", `missing ${fn}`);
  }
  const initial = store.getSnapshot();
  assert.deepEqual(initial.entries, []);
  assert.equal(initial.currentIndex, -1);
  assert.equal(initial.current, null);
});

test("playlist store tracks entries, current pointer, and notifies subscribers", async () => {
  const { createPlaylistStore } = await import("@threejson/player-kit/js/createPlaylistStore.js");
  const store = createPlaylistStore({ storagePrefix: "test.playlist" });

  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  // localStorage does not exist under Node; persistence is best-effort and must not break the model.
  const i0 = store.addUrl("json/portShow.json");
  const i1 = store.addUrl("https://example.com/roomShow.json", "Room");
  assert.equal(i0, 0);
  assert.equal(i1, 1);
  assert.equal(store.getSnapshot().entries.length, 2);
  assert.equal(store.getSnapshot().entries[0].label, "portShow.json");
  assert.equal(store.getSnapshot().entries[1].label, "Room");
  assert.ok(notifications >= 2, "subscribers should be notified on mutation");

  // getSnapshot must return a stable reference between notifications (useSyncExternalStore contract).
  assert.equal(store.getSnapshot(), store.getSnapshot());

  const activated = store.activate(1);
  assert.equal(activated.label, "Room");
  assert.equal(store.getSnapshot().currentIndex, 1);
  assert.equal(store.getSnapshot().current.label, "Room");
  assert.equal(store.activate(99), null, "out-of-range activate should be a no-op");

  const { removedCurrent, nextIndex } = await store.removeAt(1);
  assert.equal(removedCurrent, true);
  assert.equal(nextIndex, 0, "removing the last/current entry should fall back to the one before it");
  assert.equal(store.getSnapshot().entries.length, 1);

  unsubscribe();
});
