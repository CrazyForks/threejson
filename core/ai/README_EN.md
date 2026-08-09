# ThreeJSON AI API

[中文](./README.md) | [English](./README_EN.md)

Browser tutorial: [`examples/html-demo/track-05-tooling/05-01-ai-scene.html`](../../examples/html-demo/track-05-tooling/05-01-ai-scene.html) (JSON updates; command mode see Scene Editor).

`core/ai` provides **six** capability groups:

1. **Generate** — prompt → full scene JSON string.
2. **Image-to-scene** — reference image + optional text → full scene JSON (vision-capable chat model required).
3. **String-level update** — prompt + existing JSON → updated JSON (`updateMode: "incremental"` optional for RFC 6902 patches).
4. **Command-mode update** — prompt + scene context → `scene.*` / `object.*` / `material.*` / `camera.*` scripts via `requestUpdatedSceneEditCommands` (no `editor.*`).
5. **File-level update (Node)** — prompt + scene file path → write back `.json` or export-style `.js` (`core/util/nodeSceneFile.js`).
6. **Texture planning and filling** — `planTextures` + `fillTextureUrls` with pluggable `imageProvider` and `sink`.

Supported providers: `chatgpt`, `deepseek`, `custom` (OpenAI-compatible; requires `baseUrl`).

## File overview

- `threeJsonCoreSkill.js` — scene generation/update system prompts (primitives, native Three.js, infoPanel / css3dPanel / shaderSurface / particleEmitter, `sceneConfig`, few-shots).
- `sceneCapability.js` — intent hints (`buildIntentHints`) and post-generation fit review (`evaluateCapabilityFit`).
- `sceneCommandSkill.js` — command-mode prompts and script parsing.
- `texturePrompt.js` — texture task planning templates (RFC 6901 pointers).
- `textureAiService.js` — `planTextures`, `fillTextureUrls`, image provider helpers.
- `sceneAiService.js` — HTTP, `extractJsonText`, validation, `requestUpdatedSceneEditCommands`.
- `sceneAgent.js` / `agentTools.js` — adaptive direct or incremental scene execution (`agentDepth.js` remains only for legacy compatibility).
- `index.js` — public entry; mounts `window.ThreeJsonAI` in the browser.

Human-readable skill: [`SKILL.md`](./SKILL.md). Related docs: [`docs/en/json-format.md`](../../docs/en/json-format.md), [`docs/en/extensions.md`](../../docs/en/extensions.md), [`docs/en/glossary.md`](../../docs/en/glossary.md). Gap matrix (archived): [`lab/archive/ai-skill-gap-matrix.md`](../../lab/archive/ai-skill-gap-matrix.md).

## Module exports (ESM)

```js
import {
  createSceneAiClient,
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  buildSceneCommandUpdateSystemPrompt,
  planTextures,
  fillTextureUrls,
  runSceneAgent,
  createOpenAiImageProvider,
  normalizeImageRawToBlob,
  listTextureUrlPointers,
  parseSceneJsonString,
  extractJsonText,
  resolveVisionImageUrl
} from "./core/ai/index.js";
```

`updateSceneJsonFile` — import from `core/util/nodeSceneFile.js` (Node only).

`createSceneAiClient(defaultOptions)` merges defaults into each call:

- `generateSceneJsonString` — default `maxTokens: 6000`; optional `planFirst`, `capabilityReview`.
- `generateSceneJsonFromImage({ prompt?, image }, options?)`
- `updateSceneJsonString` — optional `updateMode: "incremental"`
- `requestUpdatedSceneEditCommands` — `outputMode: "commands"|"json"`
- `planTextures` / `fillTextureUrls`
- `runSceneAgent` — defaults to `executionMode: "direct"`; complex/output-limited scenes can use `"draft_refine"`

Browser globals:

```text
window.ThreeJsonAI.createSceneAiClient
window.ThreeJsonAI.generateSceneJsonString
window.ThreeJsonAI.generateSceneJsonFromImage
window.ThreeJsonAI.updateSceneJsonString
window.ThreeJsonAI.resolveVisionImageUrl
window.ThreeJsonAI.planTextures
window.ThreeJsonAI.fillTextureUrls
window.ThreeJsonAI.createOpenAiImageProvider
window.ThreeJsonAI.normalizeImageRawToBlob
window.ThreeJsonAI.listTextureUrlPointers
window.ThreeJsonAI.runSceneAgent
```

`updateSceneJsonFile` is not on `window`. Prefer server-side or local scripts for texture keys.

## Command-mode update

```js
import { requestUpdatedSceneEditCommands } from "./core/ai/index.js";

const result = await requestUpdatedSceneEditCommands(
  "Change the main building to blue-gray",
  {
    currentSceneJsonString: sceneJson,
    objectList: [{ threeJsonId: "b1", name: "Main", objType: "box" }],
    selectionId: "b1"
  },
  { provider: "chatgpt", apiKey: process.env.OPENAI_API_KEY, outputMode: "commands" }
);
// result.commands — parsed { op, args }[]
```

Common ops: `object.patch`, `material.patch`, `object.add`, `object.reconcile`, `camera.fit`, `scene.applyPatch`. Editor wraps with `editor.*` separately.

## Adaptive scene execution (`runSceneAgent`)

There is no separate single-turn/multi-turn quality switch. `executionMode: "direct"` returns one complete usable scene and is the default. `"draft_refine"` is reserved for genuinely complex scenes selected during negotiation, or for a detected direct output-limit fallback. Layout/material LLM review is off by default. The model ends incremental work with `# done`; `agent.maxRefineRounds` (default 6, hard maximum 20) is only a runaway guard, and repeated/no-op output also terminates immediately. All provider calls in one `runSceneAgent` share a total deadline (180 seconds by default, configurable through `turnTimeoutMs` or absolute `turnDeadlineAt`), so several stalled requests cannot accumulate into a many-minute hang.

```js
const result = await aiClient.runSceneAgent(
  { mode: "generate", prompt: "Small campus with roads and two buildings" },
  {
    executionMode: "direct",
    agent: { maxRefineRounds: 6 },
    turnTimeoutMs: 180000,
    apiKey: "...",
    provider: "chatgpt"
  }
);
```

## Shared options

- `provider`: `chatgpt` | `deepseek` | `custom`
- `apiKey`: required
- `model`, `baseUrl`, `temperature` (default `0.2`)
- `maxTokens`: default `4000` for updates/textures; generation often uses **6000**
- `segmentedOutput`: generation-only, `"auto"` by default. The pre-generation negotiation chooses `single`, `segmented`, or `compact`. Planned `segmented` generation starts the continuation/stitching protocol in the first response and uses `maxSceneSegments` (default 16, hard maximum 64); ordinary and compact scenes stay single-response. If an unsegmented response unexpectedly hits the provider output limit, the host performs at most one complete compact regeneration instead of blindly appending arbitrary cutoff fragments (`compactRetryOnTruncation: false` disables that retry).
- `imageDetail`: `auto` | `low` | `high` (image-to-scene only)

## Validation

- Prompts ask for raw JSON; `extractJsonText()` still strips fences for resilience.
- Loadable scenes need `worldInfo` and/or standard `objectList` + `sceneConfig`.
- Capability catalog in prompts covers css3dPanel, shaderSurface, particleEmitter; extension **bootstrap** is host responsibility ([`docs/en/extensions.md`](../../docs/en/extensions.md)).

## Manual verification

See [`tests/ai-manual-verification.md`](../../tests/ai-manual-verification.md). Automated: `npm test`, `npm run verify:ai-static`; optional live: `npm run verify:ai-live`.

Demos: [`docs/en/demos.md`](../../docs/en/demos.md), [`05-01-ai-scene.html`](../../examples/html-demo/track-05-tooling/05-01-ai-scene.html).
