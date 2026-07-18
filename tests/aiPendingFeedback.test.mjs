import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { waitForAiActivityPaint } from "../tools/scene-host/editor/js/editorAiChatShared.js";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("ThreeBox paints a preparation activity before backend turn routing starts", async () => {
  const source = await read("../tools/scene-host/threebox/js/threeBoxChatPanel.js");
  const activityIndex = source.indexOf("initialStreaming.processing(");
  const paintIndex = source.indexOf("await waitForActivityPaint();");
  const requestIndex = source.indexOf("await host.onUserMessage(text");

  assert.ok(activityIndex >= 0);
  assert.ok(paintIndex > activityIndex);
  assert.ok(requestIndex > paintIndex);
  assert.match(source, /setBusy\(true, \{ stoppable: false \}\)/);
});

test("ThreeBox generation and adjustment consume the already-visible activity", async () => {
  const source = await read("../tools/scene-host/threebox/js/threeBoxApp.js");
  assert.equal(source.match(/api\.takeInitialActivity\?\.\(\)/g)?.length, 2);
  assert.match(source, /threebox\.chat\.generating/);
  assert.match(source, /threebox\.chat\.adjusting/);
});

test("Editor generate and adjust show activity before credential negotiation", async () => {
  const [generateSource, adjustSource] = await Promise.all([
    read("../tools/scene-host/editor/js/editorAiGeneratePanel.js"),
    read("../tools/scene-host/editor/js/editorAiAdjustPanel.js")
  ]);

  for (const source of [generateSource, adjustSource]) {
    const activityIndex = source.indexOf("historyCtl.appendActivityMessage(");
    const paintIndex = source.indexOf("await waitForAiActivityPaint();");
    const credentialsIndex = source.indexOf("await ensureUsableCredentials(host)");
    assert.ok(activityIndex >= 0);
    assert.ok(paintIndex > activityIndex);
    assert.ok(credentialsIndex > paintIndex);
  }
});

test("AI activity indicators expose motion and accessible busy state", async () => {
  const [editorCss, threeboxCss, threeboxSource] = await Promise.all([
    read("../tools/scene-host/shared/css/editor-base.css"),
    read("../tools/scene-host/threebox/css/threebox.css"),
    read("../tools/scene-host/threebox/js/threeBoxChatPanel.js")
  ]);

  assert.match(editorCss, /\.aiEditMsgActivity::before/);
  assert.match(editorCss, /editorAiActivitySpin/);
  assert.match(threeboxCss, /\.streamingPreviewProcessing::before/);
  assert.match(threeboxSource, /aria-busy/);
  await waitForAiActivityPaint();
});
