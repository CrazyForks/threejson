import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("ThreeBox negotiates generate versus adjust from conversation context", async () => {
  const [source, sceneCardSource] = await Promise.all([
    read("tools/scene-host/threebox/js/threeBoxApp.js"),
    read("tools/scene-host/threebox/js/threeBoxSceneCard.js")
  ]);
  assert.match(source, /classifyThreeBoxTurnIntent\(/);
  assert.match(source, /resolveThreeBoxNegotiatedRoute\(classified, priorTurns\)/);
  assert.match(source, /userPrompt: t\.userPrompt/);
  assert.match(source, /sceneTitle: t\.sceneTitle/);
  assert.match(source, /const sceneGenerationMode = settings\.ai\?\.sceneGenerationMode \|\| "auto"/);
  assert.match(source, /applyCommands:\s*async \(commands, meta = \{\}\)/);
  assert.match(source, /refreshContext:\s*async \(\)/);
  assert.match(source, /sceneCard\.exportSceneJsonString/);
  assert.match(source, /authoritative:\s*adjustmentUsesSceneCardRuntime/);
  assert.match(sceneCardSource, /options\.authoritative !== true/);
  assert.match(sceneCardSource, /applyCommandsWithResult/);
});

test("Editor keeps intent explicit while generation still negotiates execution and capabilities", async () => {
  const [generateSource, adjustSource] = await Promise.all([
    read("tools/scene-host/editor/js/editorAiGeneratePanel.js"),
    read("tools/scene-host/editor/js/editorAiAdjustPanel.js")
  ]);
  assert.match(generateSource, /runAiGenerateTurn\(/);
  assert.match(generateSource, /classifyAiTurnIntent\(/);
  assert.match(generateSource, /executionMode:\s*negotiation\.executionMode/);
  assert.match(generateSource, /sceneGenerationMode:\s*host\.getEditorSettings\(\)\?\.ai\?\.sceneGenerationMode/);
  assert.match(generateSource, /requiresAnimation:\s*negotiation\.requiresAnimation/);
  assert.match(adjustSource, /runAiAdjustTurn\(/);
  assert.doesNotMatch(adjustSource, /classifyAiTurnIntent|classifyTurnIntent/);
});
