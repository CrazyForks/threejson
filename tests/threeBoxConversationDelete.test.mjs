import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);

test("ThreeBox history menu exposes a destructive delete action", async () => {
  const [html, css] = await Promise.all([
    readFile(repoFile("tools/scene-host/threebox/index.html"), "utf8"),
    readFile(repoFile("tools/scene-host/threebox/css/threebox.css"), "utf8")
  ]);
  assert.match(html, /data-action="delete"/);
  assert.match(html, /data-i18n="threebox\.shell\.delete"/);
  assert.match(css, /\.contextMenu button\.contextMenuDanger/);
});

test("ThreeBox confirms deletion and removes both turns and conversation metadata", async () => {
  const source = await readFile(
    repoFile("tools/scene-host/threebox/js/threeBoxSidebar.js"),
    "utf8"
  );
  const deleteHandler = source.slice(source.indexOf("'[data-action=\"delete\"]'"));
  assert.match(deleteHandler, /window\.confirm\(/);
  assert.match(deleteHandler, /threebox\.sidebar\.deleteConfirm/);
  assert.ok(deleteHandler.indexOf("deleteTurnsForConversation(conv.id)") >= 0);
  assert.ok(deleteHandler.indexOf("deleteConversation(conv.id)") >= 0);
  assert.ok(
    deleteHandler.indexOf("deleteTurnsForConversation(conv.id)") <
      deleteHandler.indexOf("deleteConversation(conv.id)"),
    "turn records should be deleted before conversation metadata"
  );
  assert.match(deleteHandler, /activeConversationId = null/);
  assert.match(deleteHandler, /host\.onDeleteConversation/);
});

test("deleting the active ThreeBox conversation clears its rendered chat", async () => {
  const source = await readFile(
    repoFile("tools/scene-host/threebox/js/threeBoxApp.js"),
    "utf8"
  );
  const callback = source.slice(source.indexOf("onDeleteConversation:"));
  assert.match(callback, /activeAbortController\?\.abort\(\)/);
  assert.match(callback, /disposeAllSceneCards\(\)/);
  assert.match(callback, /attachedContext\.clear\(\)/);
  assert.match(callback, /chatPanel\.clear\(\)/);
});
