import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { validateSceneJson, listTexturePointersSummary } from "../core/ai/agentTools.js";
import { runSceneAgent } from "../core/ai/sceneAgent.js";

const MINIMAL_SCENE = {
  threeJsonId: "agent-test",
  worldInfo: {
    boxModelList: [
      {
        name: "floor",
        objType: "box",
        geometry: { width: 10, height: 0.2, depth: 10 },
        position: { x: 0, y: 0, z: 0 },
        material: { type: "standard", color: "#888888" }
      }
    ]
  }
};

test("validateSceneJson accepts minimal scene", () => {
  const r = validateSceneJson(JSON.stringify(MINIMAL_SCENE));
  assert.equal(r.ok, true);
  assert.equal(r.boxCount, 1);
});

test("listTexturePointersSummary on scene with material", () => {
  const r = listTexturePointersSummary(MINIMAL_SCENE);
  assert.equal(r.count, 1);
});

// runSceneAgent now negotiates complexity the way ThreeBox always did (see isComplexTurn's
// docblock): a request the classifier didn't flag (the default here — no `generationStrategy`
// option, matching the unambiguous-first-turn shortcut in threeBoxApp.js) takes the FAST path —
// one call, `agentUsed: false`, no outline/draft-refine-loop/capability-layout review at all.
// Tests below that want to exercise the full pipeline (outline -> small draft ->
// repair-if-invalid -> incremental refine-to-done -> capability review -> layout review) pass
// `generationStrategy: "segmented"` explicitly, the same signal a real complexity classification
// would produce. "# done" replies keep the refine/review rounds from looping needlessly in those;
// a fetchMock's fallback branch (anything not explicitly matched) returns "# done" so any extra
// round a test doesn't care to assert on still terminates cleanly.

test("runSceneAgent repairs an invalid draft once, then completes via done/reviews", async () => {
  const validScene = JSON.stringify(MINIMAL_SCENE);
  const invalidScene = JSON.stringify({ threeJsonId: "invalid", objectList: [] });
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    // 1: outline, 2: draft (invalid), 3: repair fix (valid), 4+: refine/review rounds all "# done"
    const content = call === 1 ? "- floor\n- walls" : call === 2 ? invalidScene : call === 3 ? validScene : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(result.steps.some((s) => s.kind === "repair" && s.ok === true));
    assert.ok(fetchMock.mock.calls.length >= 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent takes the fast single-call path by default (no generationStrategy) — the negotiated-simple case", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return {
        choices: [{ message: { content: scenePayload } }]
      };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    // No `generationStrategy` matches ThreeBox's unambiguous-first-turn shortcut (and any other
    // request the classifier didn't flag) — no outline/draft-refine-loop/sceneAgent-level
    // capability+layout review overhead at all. This is the fix for "every request, however
    // trivial, paid the full pipeline's cost" — see isComplexTurn's docblock. Exactly one call is
    // the common case; generateSceneJsonString's own lightweight internal capability-fit safety
    // net (sceneAiService.js's maybeApplyCapabilityReview, unrelated to sceneAgent.js's heavier
    // review stages) may add one more small call here, same as it always could pre-redesign.
    assert.equal(result.agentUsed, false);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(fetchMock.mock.calls.length <= 2, `expected <= 2 calls, got ${fetchMock.mock.calls.length}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runSceneAgent treats generationStrategy "compact" as the fast single-call path, not as complex', async () => {
  // Regression test for a real bug: "compact" means "the AI simplified the scene so it fits one
  // response" (see sceneChatSession.js's compact instruction) — it is NOT a signal that the
  // request is complex. The classifier is guided to prefer "compact" over "segmented" whenever
  // it isn't confident segmented output is supported, so most non-trivial prompts land on
  // "compact" — treating it as complex meant almost every real request paid the full
  // draft-then-refine pipeline's cost regardless of what the AI itself decided.
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: scenePayload } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a large but simplified crowd scene" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "compact",
        estimatedSegments: 1
      }
    );
    assert.equal(result.agentUsed, false);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(fetchMock.mock.calls.length <= 2, `expected <= 2 calls, got ${fetchMock.mock.calls.length}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent runs the full agent pipeline when generationStrategy signals complexity", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return {
        choices: [{ message: { content: scenePayload } }]
      };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented"
      }
    );
    // Every call in this mock returns the same already-valid scene, so the outline is free-text,
    // the draft is immediately valid, the draft-refinement loop sees "json" output matching the
    // unchanged scene every round, and only stops once maxRefineRounds is exhausted — this test
    // only cares that the pipeline runs (because it was told to) and eventually returns a usable
    // scene.
    assert.equal(result.agentUsed, true);
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(fetchMock.mock.calls.length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent respects a caller-configured maxRefineRounds cap", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    // Never says "# done" — the loop must still terminate at the configured round cap rather
    // than spinning forever.
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content: scenePayload } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        agent: { maxRefineRounds: 2 },
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.ok(result.sceneJsonString.includes("objectList"));
    // outline(1) + draft(1) + at most 2 refine rounds + capability review(<=1) + layout review(1).
    assert.ok(fetchMock.mock.calls.length <= 6, `expected <= 6 calls, got ${fetchMock.mock.calls.length}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent texture fill soft-fails and keeps scene JSON", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return {
        choices: [{ message: { content: "# done" } }]
      };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    // First real content call must produce the valid scene; every subsequent round says "# done"
    // so refinement/review stop immediately. Swap in a one-off responder for call 2 (the draft).
    let call = 0;
    globalThis.fetch = mock.fn(async () => {
      call += 1;
      const content = call === 2 ? scenePayload : "# done";
      return {
        ok: true,
        async text() {
          return "";
        },
        async json() {
          return { choices: [{ message: { content } }] };
        }
      };
    });
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        agent: { maxRefineRounds: 1 },
        generationStrategy: "segmented",
        texture: {
          enabled: true,
          imageProvider: {
            async generateImage() {
              throw new Error("Failed to fetch");
            }
          },
          sink: {
            saveLocal: async () => "assets/textures/ai-generated/x.png"
          }
        }
      }
    );
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(result.textureFillWarning);
    assert.ok(result.steps.some((s) => s.kind === "fill_textures" && s.ok === false));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update commands agent repairs invalid script", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const validCommands =
    'object.patch id=floor partial={"material":{"color":"#336699"}}';
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    // 1: outline (free text), 2: bad round-1 reply, 3: still-bad round-2 reply, 4: valid commands
    const content =
      call === 1
        ? "- outline text"
        : call === 2
          ? "- patch floor color"
          : call === 3
            ? "not a command script"
            : validCommands;
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.outputMode, "commands");
    assert.ok(Array.isArray(result.commands));
    assert.ok(result.steps.some((s) => s.ok === false));
    assert.ok(result.steps.some((s) => s.kind === "commands" && s.ok === true));
    assert.ok(fetchMock.mock.calls.length >= 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent attaches local reference material to an agent commands round when the prompt matches a covered signal", async () => {
  // End-to-end wiring check: chatOptions.resolveReferenceUrl/locale (as a ThreeBox-style host
  // would pass them) should flow all the way from runSceneAgent's options bag down into the
  // actual chat-completion user message for a commands-mode agent round, via
  // resolveAgentReferenceMaterial + sceneReferenceCatalog.fetchReferenceMaterial.
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const manifest = [
    {
      section: "event-mechanism",
      sectionTitleEn: "Event Mechanism",
      docLinks: [{ file: "event-mechanism.md" }],
      items: [{ id: "declarative-action", json: "assets/json/demo-show/event-mechanism/declarative-action.json" }]
    }
  ];
  const fakeExample = JSON.stringify({ threeJsonId: "demo", worldInfo: { boxModelList: [] } });
  let chatMessagesLastCall = null;
  const fetchMock = mock.fn(async (url, opts) => {
    const href = String(url);
    if (href === "https://ref.test/assets/json/demo-show/manifest.json") {
      return { ok: true, async text() { return JSON.stringify(manifest); } };
    }
    if (href === "https://ref.test/docs/en/event-mechanism.md") {
      return { ok: true, async text() { return "Use object events with action(s) for click/hover."; } };
    }
    if (href === "https://ref.test/assets/json/demo-show/event-mechanism/declarative-action.json") {
      return { ok: true, async text() { return fakeExample; } };
    }
    // Chat completion endpoint
    const body = JSON.parse(opts.body);
    chatMessagesLastCall = body.messages;
    return {
      ok: true,
      async text() { return ""; },
      async json() {
        return {
          choices: [
            { message: { content: 'object.patch id=floor partial={"material":{"color":"#336699"}}' } }
          ]
        };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "add a click event on the floor",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        resolveReferenceUrl: (path) => `https://ref.test/${path}`,
        locale: "en-US"
      }
    );
    assert.equal(result.outputMode, "commands");
    assert.ok(chatMessagesLastCall, "expected at least one chat-completion call");
    const userMessage = chatMessagesLastCall.find((m) => m.role === "user")?.content || "";
    assert.ok(userMessage.includes("Event Mechanism"), "user message should include the matched section title");
    assert.ok(
      userMessage.includes("Use object events with action(s) for click/hover."),
      "user message should include the fetched doc excerpt"
    );
    assert.ok(userMessage.includes("declarative-action"), "user message should include the fetched example");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update auto accepts JSON output in agent session", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const updatedScene = JSON.stringify({
    ...MINIMAL_SCENE,
    worldInfo: {
      boxModelList: [
        {
          ...MINIMAL_SCENE.worldInfo.boxModelList[0],
          material: { type: "standard", color: "#112233" }
        }
      ]
    }
  });
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: updatedScene } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "auto"
      },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.agentUsed, true);
    assert.equal(result.outputMode, "json");
    assert.ok(result.sceneJsonString.includes("112233"));
    assert.ok(result.steps.some((s) => s.kind === "auto_json"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent emits scene_ready before texture fill", async () => {
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  const progress = [];
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 2 ? scenePayload : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return {
          choices: [{ message: { content } }]
        };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        agent: { maxRefineRounds: 1 },
        generationStrategy: "segmented",
        onProgress: (p) => progress.push(p.kind),
        texture: { enabled: false }
      }
    );
    assert.ok(progress.includes("scene_ready"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent emits stage_preview after repair", async () => {
  const validScene = JSON.stringify(MINIMAL_SCENE);
  const invalidScene = JSON.stringify({ threeJsonId: "invalid", objectList: [] });
  const progress = [];
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1 ? "- floor\n- walls" : call === 2 ? invalidScene : call === 3 ? validScene : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await runSceneAgent(
      { mode: "generate", prompt: "floor" },
      {
        apiKey: "test-key",
        provider: "deepseek",
        agent: { maxRefineRounds: 1 },
        generationStrategy: "segmented",
        onProgress: (p) => progress.push(p.kind)
      }
    );
    assert.ok(progress.includes("stage_preview"));
    assert.ok(progress.includes("scene_ready"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent refines a valid draft with mixed-output protocol until done", async () => {
  const initialScene = JSON.stringify(MINIMAL_SCENE);
  const replies = [
    "- outline text",
    initialScene,
    '[{"op":"replace","path":"/objectList/0/material/color","value":"#224466"}]',
    "# done",
    "# done" // layout review round
  ];
  const progress = [];
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: replies.shift() || "# done" } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "make a simple blockout box" },
      {
        agent: { maxRefineRounds: 5 },
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented",
        onProgress: (event) => progress.push(event)
      }
    );

    assert.equal(JSON.parse(result.sceneJsonString).objectList[0].material.color, "#224466");
    assert.ok(result.steps.some((step) => step.kind === "draft_refinement" && step.outputMode === "patch"));
    assert.ok(result.steps.some((step) => step.kind === "draft_refinement_done"));
    assert.ok(progress.filter((event) => event.kind === "stage_preview").length >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent iterative apply execs commands and skips final exec batch", async () => {
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  let fetchCall = 0;
  let applyCount = 0;
  let refreshCount = 0;
  const progress = [];
  const fetchMock = mock.fn(async () => {
    fetchCall += 1;
    // 1: outline, 2: round-1 commands, 3+: done
    const content =
      fetchCall === 1
        ? "- outline text"
        : fetchCall === 2
          ? 'object.patch id=floor partial={"material":{"color":"#112233"}}'
          : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        generationStrategy: "segmented",
        applyCommands: async (commands, meta) => {
          if (meta.readOnly) {
            return { ok: true, sceneMutated: false };
          }
          applyCount += 1;
          assert.ok(Array.isArray(commands) && commands.length > 0);
          return { ok: true, sceneMutated: true };
        },
        refreshContext: async () => {
          refreshCount += 1;
          return { currentSceneJsonString: currentScene, objectList: [] };
        },
        onProgress: (p) => progress.push(p.kind)
      }
    );
    assert.equal(result.iterativeApplied, true);
    assert.equal(result.skipFinalExec, true);
    assert.equal(result.execOk, true);
    assert.equal(applyCount, 1);
    assert.equal(refreshCount, 1);
    assert.ok(progress.includes("commands_applied"));
    assert.ok(progress.includes("refine"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update commands stays non-iterative and skips outline for an edit the classifier did not flag as complex", async () => {
  // Even with applyCommands/refreshContext both supplied (so iteration COULD run), a request with
  // no generationStrategy (or "single") must not iterate or pay for an outline call — this is
  // what keeps a one-line "change the color" adjustment fast instead of being invited to keep
  // "refining" the scene for several rounds before it's allowed to say it's done.
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const validCommands = 'object.patch id=floor partial={"material":{"color":"#336699"}}';
  const fetchMock = mock.fn(async () => ({
    ok: true,
    async text() {
      return "";
    },
    async json() {
      return { choices: [{ message: { content: validCommands } }] };
    }
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands",
        updateContext: { objectList: [{ threeJsonId: "floor", objType: "box" }] }
      },
      {
        apiKey: "test-key",
        provider: "deepseek",
        applyCommands: async () => ({ ok: true, sceneMutated: true }),
        refreshContext: async () => ({ currentSceneJsonString: currentScene, objectList: [] })
      }
    );
    assert.equal(result.outputMode, "commands");
    assert.equal(result.iterativeApplied, undefined);
    assert.ok(Array.isArray(result.commands) && result.commands.length > 0);
    assert.equal(fetchMock.mock.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent update commands falls back to the non-iterative runner without applyCommands/refreshContext", async () => {
  // canIterate requires BOTH applyCommands and refreshContext — omitting them (as a bare core/ai
  // caller with no live/offscreen runtime would) must not throw; it should use the
  // collect-one-batch-and-return runner instead.
  const currentScene = JSON.stringify(MINIMAL_SCENE);
  const validCommands = 'object.patch id=floor partial={"material":{"color":"#336699"}}';
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1 ? "- outline text" : validCommands;
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: "change floor color",
        currentSceneJsonString: currentScene,
        outputMode: "commands"
      },
      {
        apiKey: "test-key",
        provider: "deepseek"
      }
    );
    assert.equal(result.outputMode, "commands");
    assert.equal(result.iterativeApplied, undefined);
    assert.ok(Array.isArray(result.commands) && result.commands.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent tolerates an outline failure and still produces a scene", async () => {
  // The outline is a cheap, best-effort planning aid — an empty/flaky response from that one call
  // must not abort the whole turn before a single scene JSON call has even been attempted.
  const scenePayload = JSON.stringify(MINIMAL_SCENE);
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    const content = call === 1 ? "" : call === 2 ? scenePayload : "# done";
    return {
      ok: true,
      async text() {
        return "";
      },
      async json() {
        return { choices: [{ message: { content } }] };
      }
    };
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt: "a small floor" },
      { apiKey: "test-key", provider: "deepseek", generationStrategy: "segmented" }
    );
    assert.ok(result.sceneJsonString.includes("objectList"));
    assert.ok(result.steps.some((s) => s.kind === "outline" && s.ok === false));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runSceneAgent keeps a valid draft when both capability and layout review rounds fail", async () => {
  // The prompt asks for a visible text label; the draft only carries it as box metadata (no
  // objType:"text" item), so evaluateSceneCapabilityFit reports a gap and both the capability and
  // layout review stages attempt a fix — every one of those attempts (and their full-JSON
  // fallbacks) fails here (network error). None of that may turn an already-valid draft into a
  // reported generation failure.
  const cabinScene = JSON.stringify({
    threeJsonId: "cabin-scene",
    objectList: [{ threeJsonId: "cabin", objType: "box", label: "森林之家" }]
  });
  const prompt = "在小木屋门口添加文字'森林之家'";
  let call = 0;
  const fetchMock = mock.fn(async () => {
    call += 1;
    if (call === 1) {
      return { ok: true, async text() { return ""; }, async json() { return { choices: [{ message: { content: "- cabin\n- label" } }] }; } };
    }
    if (call === 2) {
      return { ok: true, async text() { return ""; }, async json() { return { choices: [{ message: { content: cabinScene } }] }; } };
    }
    if (call === 3) {
      // Draft refinement round: say done immediately to keep the mock sequence small.
      return { ok: true, async text() { return ""; }, async json() { return { choices: [{ message: { content: "# done" } }] }; } };
    }
    // Capability review's attempt + full-JSON fallback, then layout review's attempt + fallback —
    // all fail.
    throw new Error("network down");
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const result = await runSceneAgent(
      { mode: "generate", prompt },
      { apiKey: "test-key", provider: "deepseek", generationStrategy: "segmented" }
    );
    assert.equal(JSON.parse(result.sceneJsonString).threeJsonId, "cabin-scene");
    assert.ok(result.steps.some((s) => s.kind === "capability_review"));
    assert.ok(result.steps.some((s) => s.kind === "layout_review"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
