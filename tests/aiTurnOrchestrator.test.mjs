import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mock, test } from "node:test";
import { runAiAdjustTurn } from "../tools/scene-host/shared/js/aiTurnOrchestrator.js";

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
    assert.equal(applied.length, 1);
    assert.equal(result.commands.length, 1);
    assert.equal(fetchMock.mock.calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
