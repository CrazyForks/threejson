import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import {
  resolveImmediateDirectGeneration,
  runAiAdjustTurn
} from "../tools/scene-host/shared/js/aiTurnOrchestrator.js";

const SCENE = JSON.stringify({
  threeJsonId: "live-adjust-test",
  objectList: [{
    threeJsonId: "floor",
    objType: "box",
    geometry: { width: 10, height: 0.2, depth: 10 },
    material: { color: "#888888" }
  }]
});

test("image generation wires the same incremental draft command executor as text generation", async () => {
  const source = await readFile(
    new URL("../tools/scene-host/shared/js/aiTurnOrchestrator.js", import.meta.url),
    "utf8"
  );
  const imageRunner = source.slice(
    source.indexOf("export async function runAiImageGenerateTurn"),
    source.indexOf("export async function classifyAiTurnIntent")
  );
  assert.match(imageRunner, /applyDraftCommands:\s*applyAiDraftCommands/);
});

test("bounded first generations skip a redundant classifier call while large requests still negotiate", () => {
  const direct = resolveImmediateDirectGeneration({
    userPrompt: "生成一个地月系统，地球自转，月球绕地球公转",
    history: []
  });
  assert.equal(direct?.executionMode, "direct");
  assert.equal(direct?.generationStrategy, "single");
  assert.equal(direct?.selectedCapabilityIds, undefined);

  assert.equal(resolveImmediateDirectGeneration({
    userPrompt: "生成一座包含四个分区、交通基础设施和数百栋建筑的城市",
    history: []
  }), null);
  assert.equal(resolveImmediateDirectGeneration({
    userPrompt: "把月球改成红色",
    history: [{ turnId: "earth", summary: "地月系统" }]
  }), null);
});

test("runAiAdjustTurn applies automatic rounds through host live-runtime callbacks", async () => {
  const replies = [
    "- adjust floor color",
    'object.patch id=floor partial={"material":{"color":"#336699"}}',
    "# done"
  ];
  const applied = [];
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() { return ""; },
    async json() { return { choices: [{ message: { content: replies.shift() || "# done" } }] }; }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runAiAdjustTurn({
      userPrompt: "change the floor color",
      envelope: "change the floor color",
      targetSceneJsonString: SCENE,
      providerOptions: { apiKey: "test-key", provider: "deepseek" },
      agentOptions: { maxRefineRounds: 4 },
      updateOutputMode: "auto",
      resolveContextPayload: () => ({ objectList: [{ threeJsonId: "floor", objType: "box" }] }),
      applyCommands: async (commands) => {
        applied.push(...commands);
        return { ok: true, sceneMutated: true };
      },
      refreshContext: async () => ({
        currentSceneJsonString: SCENE,
        fullSceneJson: SCENE,
        objectList: [{ threeJsonId: "floor", objType: "box" }]
      })
    });

    assert.equal(result.liveApplied, true);
    assert.equal(result.agentResult.completed, true);
    assert.equal(result.agentResult.stopReason, "no_change");
    assert.equal(applied.length, 1);
    assert.equal(result.commands.length, 1);
    assert.equal(fetchMock.mock.calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
