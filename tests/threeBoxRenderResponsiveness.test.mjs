import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function readWorkspaceFile(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("ThreeBox starts its scene runtime before asynchronous deployment finishes", async () => {
  const source = await readWorkspaceFile("tools/scene-host/threebox/js/threeBoxSceneCard.js");
  assert.match(source, /onRuntimeReady:\s*\(\{ runtime: readyRuntime \}\)\s*=>\s*\{\s*activateRuntime\(readyRuntime\)/);
  assert.match(source, /runtime\.start\?\.\(\)/);
  assert.match(source, /onDeployProgress:\s*\(\{ runtime: deployingRuntime, deploy \}\)/);
  assert.match(source, /showCompactLoadingProgress\(deploy\)/);
});

test("ThreeBox final Agent result supersedes queued draft previews", async () => {
  const source = await readWorkspaceFile("tools/scene-host/threebox/js/threeBoxApp.js");
  const closeIndex = source.indexOf("previewQueueOpen = false;");
  const finalRenderIndex = source.indexOf("await sceneCard.render(outputSceneJson", closeIndex);
  assert.ok(closeIndex >= 0);
  assert.ok(finalRenderIndex > closeIndex);
  assert.doesNotMatch(source.slice(closeIndex, finalRenderIndex), /await previewRenderQueue/);
});

test("ThreeBox JSON viewer opens as plain text and upgrades in idle chunks", async () => {
  const source = await readWorkspaceFile("tools/scene-host/threebox/js/threeBoxChatPanel.js");
  assert.match(source, /plainBlock = buildPlainJsonCodeBlock\(text\)/);
  assert.match(source, /requestIdleCallback\(callback, \{ timeout: 500 \}\)/);
  assert.match(source, /chunkCount < 240/);
  assert.match(source, /plainBlock\.replaceWith\(richBlock\)/);
});

test("built-in provider quota UI omits monetary cost estimates", async () => {
  const [threeBoxSource, editorSource] = await Promise.all([
    readWorkspaceFile("tools/scene-host/threebox/js/threeBoxSettingsModal.js"),
    readWorkspaceFile("tools/scene-host/editor/js/settingsModal.js")
  ]);
  for (const source of [threeBoxSource, editorSource]) {
    assert.doesNotMatch(source, /costUsedUsdCents|costLimitUsdCents|预估花费/);
    assert.match(source, /remaining/);
  }
});
