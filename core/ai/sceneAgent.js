/**
 * Scene agent with two independent concerns: `generationStrategy` controls full-JSON transport,
 * while `executionMode` controls whether a scene is authored directly or built incrementally.
 * Direct is the default and produces one complete, immediately usable scene. `draft_refine` is
 * reserved for genuinely complex scenes or a direct output-limit fallback. Incremental loops stop
 * on `# done`, repeated/no-op output, or their runaway guard; the guard is never a target.
 *
 * Generation and adjustment share the same commands/patch/full-JSON/done protocol, compact spatial
 * context and round-budget semantics. Their small host adapters remain separate only because a
 * generated draft may be applied through a stateless callback while adjustment owns a reusable
 * live/off-screen runtime with refresh/exploration hooks.
 *
 * Repair/capability-review/layout-review still exist (real domain knowledge lives in
 * evaluateSceneCapabilityFit/buildLayoutReviewPrompt); capability/layout fixes now go through
 * runTargetedFixRound, which prefers a small commands/JSON-Patch fix and only falls back to a
 * full-scene-JSON rewrite when that isn't available or doesn't work out.
 */
import {
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  requestSceneRefinementStep,
  dryRunUpdateCommands,
  projectSceneJsonString,
  parseSceneJsonString
} from "./sceneAiService.js";
import {
  buildSceneCommandUpdateUserMessage,
  commandListHasMutatingOp,
  commandListIsEmptyOrCommentsOnly,
  commandScriptIndicatesDone,
  commandScriptRequestsContinuation
} from "./sceneCommandSkill.js";
import {
  validateSceneJsonWithNormalizer,
  listTexturePointersSummary,
  requestSceneOutline,
  planTexturesDry,
  buildLayoutReviewPrompt,
  evaluateSceneCapabilityFit,
  buildCapabilityFixPrompt
} from "./agentTools.js";
import { fillTextureUrls, createOpenAiImageProvider } from "./textureAiService.js";
import { matchIntentSignals } from "./sceneCapability.js";
import { fetchReferenceMaterial } from "./sceneReferenceCatalog.js";
import {
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile
} from "./sceneSpatialContext.js";

/**
 * @typedef {object} SceneAgentProgress
 * @property {number} step
 * @property {string} kind
 * @property {string} message
 * @property {object} [usageEstimate]
 */

/** Cheap, text-only planning call before any scene JSON is authored. */
const OUTLINE_MAX_TOKENS = 1200;
/** First-pass scene: deliberately small so it is structurally unable to hit an output-length
 * truncation — a rough, correctly-structured blockout, not the finished scene. Detail is added
 * afterward by the incremental refine loop, a small step at a time. */
const DRAFT_MAX_TOKENS = 2200;
/** Per-round budget for the incremental refine loop (commands / JSON Patch / a bounded full-JSON
 * rewrite for one round when neither of those is available) — generous headroom for a single
 * small step, still far below a whole-scene rewrite budget. */
const REFINE_ROUND_MAX_TOKENS = 3000;
/** Command-first adjustments should not inherit the full-scene rewrite budget. A real command
 * cutoff is surfaced immediately so the host can continue incrementally or use its Patch/full
 * JSON fallback instead of retrying the same oversized response until the round guard expires. */
const COMMAND_UPDATE_MAX_TOKENS = 3000;
/** Only reached when a round has no incremental-apply mechanism available at all (bare `core/ai`
 * callers with no live/offscreen runtime) — the lowest-priority fallback, not the common path. */
const FULL_REWRITE_MAX_TOKENS = 6000;
/** Default runaway guard for the comparatively rare incremental path. */
const DEFAULT_MAX_REFINE_ROUNDS = 6;
/** Hard ceiling enforced regardless of what a caller/user configures — a stuck loop (model never
 * emits `# done`) must still terminate. */
const HARD_MAX_REFINE_ROUNDS = 20;
const MAX_CAPABILITY_REVIEW_ATTEMPTS = 1;
const MAX_REPAIR_ATTEMPTS = 2;

/**
 * @param {object} agentOptions
 * @returns {{ maxRefineRounds: number }}
 */
function normalizeAgentOptions(agentOptions = {}) {
  const raw = Number(agentOptions?.maxRefineRounds);
  const maxRefineRounds =
    Number.isFinite(raw) && raw > 0
      ? Math.max(1, Math.min(HARD_MAX_REFINE_ROUNDS, Math.round(raw)))
      : DEFAULT_MAX_REFINE_ROUNDS;
  return { maxRefineRounds };
}

function normalizeExecutionMode(value) {
  return value === "draft_refine" ? "draft_refine" : "direct";
}

/** Scene hosts pass a JSON envelope so routing/capability metadata reaches the generation prompt.
 * Local semantic checks must inspect only the actual user request: matching the envelope field
 * name `requiresAnimation` used to create a false animation gap even when its value was `false`. */
function extractUserRequest(prompt) {
  const raw = String(prompt || "").trim();
  try {
    const envelope = JSON.parse(raw);
    if (envelope && typeof envelope === "object" && typeof envelope.userRequest === "string") {
      return envelope.userRequest.trim() || raw;
    }
  } catch {
    /* plain prompt or an envelope followed by extra authoring guidance */
  }
  return raw;
}

function normalizedSceneSignature(sceneJsonString) {
  try {
    return JSON.stringify(parseSceneJsonString(sceneJsonString));
  } catch {
    return String(sceneJsonString || "").trim();
  }
}

function isSceneOutputLimitError(error) {
  if (error?.code === "SCENE_OUTPUT_LIMIT") {
    return true;
  }
  return /output limit|not completed after .*segments|maximum output|token limit/i.test(
    String(error?.message || error || "")
  );
}

function completionReasonIndicatesCutoff(reason) {
  return /length|max[_ -]?tokens?|token[_ -]?limit|incomplete|truncat/i.test(String(reason || ""));
}

const KNOWN_PLANET_TEXTURES = Object.freeze([
  { file: "earth.png", aliases: ["earth", "地球"] },
  { file: "moon.png", aliases: ["moon", "月球"] },
  { file: "sun.png", aliases: ["sun", "太阳"] },
  { file: "mercury.png", aliases: ["mercury", "水星"] },
  { file: "venus.png", aliases: ["venus", "金星"] },
  { file: "mars.png", aliases: ["mars", "火星"] },
  { file: "jupiter.png", aliases: ["jupiter", "木星"] },
  { file: "saturn.png", aliases: ["saturn", "土星"] },
  { file: "uranus.png", aliases: ["uranus", "天王星"] },
  { file: "neptune.png", aliases: ["neptune", "海王星"] }
]);

function textContainsAlias(text, alias) {
  const haystack = String(text || "").toLowerCase();
  const needle = String(alias || "").toLowerCase();
  if (!needle) return false;
  if (/^[a-z]+$/.test(needle)) {
    return new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`, "i").test(haystack);
  }
  return haystack.includes(needle);
}

/**
 * Applies deterministic same-origin textures for named spherical Solar-System bodies. This is a
 * narrow asset-catalog fallback, not a general semantic rewrite: it only runs when texture hints
 * are enabled and both the user request and descriptor name identify the same body. Unless the
 * user explicitly supplied a URL, a remote/model-invented planet map is normalized to the stable
 * local asset as well. A white tint avoids the common black-map failure.
 */
function applyKnownPlanetTextureDefaults(sceneJsonString, userPrompt, enabled) {
  if (enabled !== true) {
    return { sceneJsonString, applied: [] };
  }
  let scene;
  try {
    scene = parseSceneJsonString(sceneJsonString);
  } catch {
    return { sceneJsonString, applied: [] };
  }
  const promptText = String(userPrompt || "");
  const wholeSolarSystem = /solar\s+system|太阳系/i.test(promptText);
  const earthMoonSystem = /earth\s*[-+&/]?\s*moon\s+system|地月系统/i.test(promptText);
  const requested = KNOWN_PLANET_TEXTURES.filter((entry) =>
    wholeSolarSystem ||
    (earthMoonSystem && ["earth.png", "moon.png"].includes(entry.file)) ||
    entry.aliases.some((alias) => textContainsAlias(promptText, alias))
  );
  if (!requested.length) {
    return { sceneJsonString, applied: [] };
  }
  const userProvidedTextureUrl = /(?:https?:\/\/|data:image\/|blob:|\/assets\/)/i.test(String(userPrompt || ""));
  const applied = [];
  const visit = (descriptor, listName = "") => {
    if (!descriptor || typeof descriptor !== "object") return;
    const semanticText = [descriptor.threeJsonId, descriptor.name, descriptor.label].filter(Boolean).join(" ");
    const looksSpherical =
      descriptor.objType === "sphere" ||
      descriptor.geometry?.type === "sphere" ||
      listName === "sphereModelList" ||
      Number.isFinite(Number(descriptor.geometry?.radius));
    if (looksSpherical) {
      const match = requested.find((entry) =>
        entry.aliases.some((alias) => textContainsAlias(semanticText, alias))
      );
      const targetTextureUrl = match
        ? `/assets/textures/environment/nature/planet/${match.file}`
        : "";
      const currentTextureUrl = String(descriptor.material?.textureUrl || "").trim();
      const currentColor = String(descriptor.material?.color || "").trim().toLowerCase();
      if (
        match &&
        !userProvidedTextureUrl &&
        (currentTextureUrl !== targetTextureUrl || currentColor !== "#ffffff")
      ) {
        if (!descriptor.material || typeof descriptor.material !== "object") {
          descriptor.material = { type: "standard" };
        }
        descriptor.material.textureUrl = targetTextureUrl;
        descriptor.material.color = "#ffffff";
        applied.push({ threeJsonId: descriptor.threeJsonId || "", textureUrl: descriptor.material.textureUrl });
      }
    }
    const saturnRequested = requested.some((entry) => entry.file === "saturn.png");
    const looksLikeSaturnRing =
      saturnRequested &&
      (textContainsAlias(semanticText, "saturn ring") || textContainsAlias(semanticText, "土星环")) &&
      (descriptor.objType === "ring" || descriptor.objType === "torus" || /ring|torus/i.test(String(descriptor.geometry?.type || "")));
    if (looksLikeSaturnRing && !userProvidedTextureUrl) {
      if (!descriptor.material || typeof descriptor.material !== "object") {
        descriptor.material = { type: "standard" };
      }
      const ringTextureUrl = "/assets/textures/environment/nature/planet/saturn_ring.png";
      if (descriptor.material.textureUrl !== ringTextureUrl || String(descriptor.material.color || "").toLowerCase() !== "#ffffff") {
        descriptor.material.textureUrl = ringTextureUrl;
        descriptor.material.color = "#ffffff";
        applied.push({ threeJsonId: descriptor.threeJsonId || "", textureUrl: ringTextureUrl });
      }
    }
    for (const key of ["children", "objectList", "joins", "inters", "holes"]) {
      if (Array.isArray(descriptor[key])) descriptor[key].forEach((child) => visit(child, key));
    }
  };
  if (Array.isArray(scene.objectList)) scene.objectList.forEach((descriptor) => visit(descriptor, "objectList"));
  if (scene.worldInfo && typeof scene.worldInfo === "object") {
    for (const [listName, descriptors] of Object.entries(scene.worldInfo)) {
      if (Array.isArray(descriptors)) {
        descriptors.forEach((descriptor) => visit(descriptor, listName));
      }
    }
  }
  if (!applied.length) {
    return { sceneJsonString, applied };
  }
  return { sceneJsonString: JSON.stringify(scene, null, 2), applied };
}

/**
 * @param {SceneAgentProgress|undefined} payload
 * @param {((p: SceneAgentProgress) => void)|undefined} onProgress
 */
function emitProgress(payload, onProgress) {
  if (typeof onProgress === "function" && payload) {
    onProgress(payload);
  }
}

/**
 * @param {object} params
 * @param {string} params.sceneJsonString
 * @param {((p: object) => void)|undefined} params.onProgress
 * @param {() => number} params.getStepIndex
 * @param {(value: number) => void} params.setStepIndex
 * @param {string} [params.message]
 */
function emitStagePreview({ sceneJsonString, onProgress, getStepIndex, setStepIndex, message, stage, round, maxRounds, commands, outputMode }) {
  if (!sceneJsonString?.trim()) {
    return;
  }
  setStepIndex(getStepIndex() + 1);
  emitProgress(
    {
      step: getStepIndex(),
      kind: "stage_preview",
      // `stage` is the stable, i18n-friendly identifier (e.g. "initial_draft", "repair",
      // "draft_refinement", "capability_review", "layout_review"); `message` stays as the
      // English fallback for non-i18n callers (CLI tools, MCP server).
      stage,
      round,
      maxRounds,
      commands,
      outputMode,
      message: message || "Stage preview ready.",
      sceneJsonString
    },
    onProgress
  );
}

/** Best-effort, once-per-turn lookup of local docs/example material for capabilities the user's
 * prompt needs but the always-injected system-prompt catalog only mentions in passing (event
 * mechanism, scripts, business domains, etc. — see sceneReferenceCatalog.js). No-ops (returns "")
 * unless the host opted in by passing `chatOptions.resolveReferenceUrl`; never throws, so a
 * fetch failure never blocks the agent turn it was meant to help. */
async function resolveAgentReferenceMaterial(userPrompt, chatOptions) {
  if (chatOptions?.capabilityLookup === false || typeof chatOptions?.resolveReferenceUrl !== "function") {
    return "";
  }
  try {
    const signals = Array.isArray(chatOptions?.selectedCapabilityIds)
      ? chatOptions.selectedCapabilityIds.map((id) => ({ id }))
      : matchIntentSignals(userPrompt);
    return await fetchReferenceMaterial(signals, {
      resolveUrl: chatOptions.resolveReferenceUrl,
      locale: chatOptions.locale
    });
  } catch (_err) {
    return "";
  }
}

/**
 * A `requestUpdatedSceneEditCommands` result with `outputMode:"patch"` has already had its RFC
 * 6902 patch applied locally (see sceneAiService.js's tryApplyContentAsPatch) — it just needs to
 * reach the runtime. Wrapping the already-patched JSON in a single `scene.load` command lets it
 * flow through the exact same dry-run/apply/undo machinery as ordinary commands, with no special
 * casing needed anywhere else (the executor and every applyCommands closure already support
 * `scene.load`'s `args.json`).
 * @param {{outputMode:"patch", sceneJsonString: string}} patchResult
 * @returns {{op:"scene.load", args:{json: object}}[]}
 */
function commandsFromPatchResult(patchResult) {
  return [{ op: "scene.load", args: { json: parseSceneJsonString(patchResult.sceneJsonString) } }];
}

/**
 * @param {object} params
 * @returns {Promise<object>}
 */
async function runSceneAgentCommandsUpdate(params) {
  const {
    userPrompt,
    currentSceneJsonString,
    updateContext = {},
    updateOutputMode,
    preset,
    outline,
    chatOptions,
    onProgress,
    steps,
    getStepIndex,
    setStepIndex,
    depth,
    validateCommands
  } = params;

  const maxCommandRounds =
    preset.maxRefineRounds ?? Math.max(preset.maxRepairAttempts ?? 1, 4);
  let round = 0;
  let lastError = "";
  let lastRawContent = "";

  const baseContext = {
    ...updateContext,
    currentSceneJsonString
  };

  // Resolved once for the whole turn (not per round) — same material is relevant across repair
  // attempts, and this avoids refetching on every round.
  const referenceMaterial = await resolveAgentReferenceMaterial(userPrompt, chatOptions);

  while (round < maxCommandRounds) {
    round += 1;
    const isRepair = Boolean(lastError);
    setStepIndex(getStepIndex() + 1);
    const progressMessage = isRepair
      ? `Command repair (${round}/${maxCommandRounds}): ${lastError}`
      : baseContext.objectGetFeedback && round > 1
        ? `Continuing after scene inspection (${round}/${maxCommandRounds})...`
        : "Generating scene edit commands...";
    emitProgress(
      {
        step: getStepIndex(),
        kind: isRepair ? "repair" : baseContext.objectGetFeedback && round > 1 ? "explore" : "commands",
        round,
        maxRounds: maxCommandRounds,
        error: isRepair ? lastError : undefined,
        message: progressMessage
      },
      onProgress
    );

    const requestPrompt = isRepair
      ? `Fix the command script. Error: ${lastError}. User intent: ${userPrompt}`
      : outline && round === 1
        ? `${userPrompt}\n\nFollow this outline:\n${outline}`
        : userPrompt;

    // Always explicitly built now (previously only for repair/feedback/round>1 rounds, leaving
    // round 1 to requestUpdatedSceneEditCommands's own internal fallback construction — which
    // used the exact same fields, so this is behavior-preserving for round 1 except for also
    // attaching referenceMaterial there, which is the point: proactively giving the agent
    // relevant docs/examples from round 1 avoids burning repair rounds on gaps the base prompt
    // catalog doesn't cover, rather than only reacting after a failure).
    const context = { ...baseContext };
    context.userMessage = [
      buildSceneCommandUpdateUserMessage({
        modificationRequest: requestPrompt,
        objectList: baseContext.objectListForMessage ?? baseContext.objectList,
        selectionId: baseContext.selectionId ?? null,
        selectionDescriptor: baseContext.selectionDescriptor ?? null,
        fullSceneJson: baseContext.fullSceneJson,
        objectGetFeedback: baseContext.objectGetFeedback,
        objectSpatialCards: baseContext.objectSpatialCards,
        sceneScaleProfile: baseContext.sceneScaleProfile,
        referenceObjects: baseContext.referenceObjects,
        placementHints: baseContext.placementHints,
        assemblyIntentHints: baseContext.assemblyIntentHints,
        singleRound: false,
        agentRound: true
      }),
      referenceMaterial,
      lastRawContent ? `Previous invalid output:\n${lastRawContent}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    let commandResult;
    try {
      commandResult = await requestUpdatedSceneEditCommands(requestPrompt, context, {
        ...chatOptions,
        outputMode: updateOutputMode,
        fallbackToJson: false,
        agentRound: true,
        singleRound: false,
        maxTokens: isRepair ? preset.repairMaxTokens : preset.commandMaxTokens
      });
    } catch (err) {
      if (isSceneOutputLimitError(err)) {
        throw err;
      }
      lastError = String(err?.message || err);
      steps.push({
        kind: isRepair ? "repair" : "commands",
        attempt: round,
        ok: false,
        error: lastError
      });
      continue;
    }

    lastRawContent = String(commandResult.rawContent || commandResult.commandScript || "");

    if (commandResult.outputMode === "json") {
      const validation = await validateSceneJsonWithNormalizer(commandResult.sceneJsonString);
      steps.push({
        kind: updateOutputMode === "auto" ? "auto_json" : "json",
        attempt: round,
        ok: validation.ok,
        error: validation.error
      });
      if (validation.ok) {
        return {
          outputMode: "json",
          sceneJsonString: commandResult.sceneJsonString,
          steps,
          agentUsed: true,
          tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
        };
      }
      lastError = validation.error || "Scene JSON validation failed.";
      continue;
    }

    if (commandResult.outputMode === "patch") {
      commandResult = { ...commandResult, commands: commandsFromPatchResult(commandResult) };
    }

    const dryRun = await dryRunUpdateCommands(commandResult.commands, baseContext.currentSceneJsonString);
    if (!dryRun.ok) {
      const fail = dryRun.results?.find((item) => !item.ok);
      lastError = fail?.error || "Command dry-run failed.";
      steps.push({
        kind: isRepair ? "repair" : "commands",
        attempt: round,
        ok: false,
        error: lastError
      });
      continue;
    }

    if (!commandListHasMutatingOp(commandResult.commands)) {
      if (typeof validateCommands === "function") {
        const external = await validateCommands(commandResult.commands, { baseContext });
        if (external?.objectGetFeedback) {
          baseContext.objectGetFeedback = external.objectGetFeedback;
        }
        if (!external?.ok) {
          if (external?.objectGetFeedback) {
            steps.push({
              kind: "explore",
              attempt: round,
              ok: true
            });
            lastError = "";
            continue;
          }
          lastError = external?.error || "Command set has no mutating commands.";
          steps.push({
            kind: "repair",
            attempt: round,
            ok: false,
            error: lastError
          });
          continue;
        }
      } else {
        lastError =
          "Session ended with read-only commands only (object.get / scene.list). Output mutating commands or full scene JSON.";
        steps.push({
          kind: "repair",
          attempt: round,
          ok: false,
          error: lastError
        });
        continue;
      }
    } else if (typeof validateCommands === "function") {
      const external = await validateCommands(commandResult.commands, { baseContext });
      if (!external?.ok) {
        lastError = external?.error || "Command validation failed.";
        steps.push({
          kind: "repair",
          attempt: round,
          ok: false,
          error: lastError
        });
        continue;
      }
    }

    lastError = "";
    steps.push({
      kind: "commands",
      attempt: round,
      ok: true,
      count: commandResult.commands.length
    });
    return {
      outputMode: "commands",
      commandScript: commandResult.commandScript,
      commands: commandResult.commands,
      steps,
      agentUsed: true,
      tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
    };
  }

  throw new Error(lastError || `Command agent failed after ${maxCommandRounds} round(s).`);
}

/**
 * Iterative apply loop: exec mutating commands each round, refresh context, continue until # done.
 * @param {object} params
 * @returns {Promise<object>}
 */
async function runSceneAgentCommandsUpdateIterative(params) {
  const {
    userPrompt,
    currentSceneJsonString,
    updateContext = {},
    updateOutputMode,
    preset,
    outline,
    chatOptions,
    onProgress,
    steps,
    getStepIndex,
    setStepIndex,
    depth,
    applyCommands,
    refreshContext
  } = params;

  if (typeof applyCommands !== "function" || typeof refreshContext !== "function") {
    throw new Error("iterativeApply requires applyCommands and refreshContext callbacks.");
  }

  const maxRefineRounds = preset.maxRefineRounds ?? 4;
  const baseContext = {
    ...updateContext,
    currentSceneJsonString
  };
  let lastError = "";
  let lastRawContent = "";
  let appliedRounds = 0;
  let anySceneMutated = false;
  const appliedCommands = [];
  let previousMutatingSignature = "";

  // Resolved once for the whole turn — see runSceneAgentCommandsUpdate's matching comment.
  const referenceMaterial = await resolveAgentReferenceMaterial(userPrompt, chatOptions);

  for (let refineRound = 1; refineRound <= maxRefineRounds; refineRound += 1) {
    chatOptions?.signal?.throwIfAborted?.();
    setStepIndex(getStepIndex() + 1);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "refine",
        round: refineRound,
        maxRounds: maxRefineRounds,
        message: `Agent refine round ${refineRound}/${maxRefineRounds}...`
      },
      onProgress
    );

    const requestPrompt =
      refineRound === 1
        ? outline
          ? `${userPrompt}\n\nFollow this outline:\n${outline}`
          : userPrompt
        : `${userPrompt}\n\nContinue refining the scene on canvas. Output the next small patch, or # done when satisfied.`;

    const context = { ...baseContext };
    context.userMessage = buildSceneCommandUpdateUserMessage({
      modificationRequest: requestPrompt,
      objectList: baseContext.objectListForMessage ?? baseContext.objectList,
      selectionId: baseContext.selectionId ?? null,
      selectionDescriptor: baseContext.selectionDescriptor ?? null,
      fullSceneJson: baseContext.fullSceneJson,
      objectGetFeedback: baseContext.objectGetFeedback,
      objectSpatialCards: baseContext.objectSpatialCards,
      sceneScaleProfile: baseContext.sceneScaleProfile,
      referenceObjects: baseContext.referenceObjects,
      placementHints: baseContext.placementHints,
      assemblyIntentHints: baseContext.assemblyIntentHints,
      singleRound: false,
      agentRound: true
    });
    if (referenceMaterial) {
      context.userMessage = `${context.userMessage}\n\n${referenceMaterial}`;
    }
    if (lastRawContent && refineRound > 1) {
      context.userMessage = `${context.userMessage}\n\nPrevious output:\n${lastRawContent}`;
    }
    if (lastError) {
      context.userMessage = `${context.userMessage}\n\nPrevious error: ${lastError}`;
    }

    let commandResult;
    try {
      commandResult = await requestUpdatedSceneEditCommands(requestPrompt, context, {
        ...chatOptions,
        outputMode: updateOutputMode,
        fallbackToJson: false,
        agentRound: true,
        iterativeApply: true,
        singleRound: false,
        maxTokens: preset.commandMaxTokens
      });
    } catch (err) {
      if (isSceneOutputLimitError(err)) {
        throw err;
      }
      lastError = String(err?.message || err);
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

    const priorRoundError = lastError;
    lastRawContent = String(commandResult.rawContent || commandResult.commandScript || "");
    lastError = "";

    if (commandResult.outputMode === "json") {
      const validation = await validateSceneJsonWithNormalizer(commandResult.sceneJsonString);
      steps.push({
        kind: updateOutputMode === "auto" ? "auto_json" : "json",
        round: refineRound,
        ok: validation.ok,
        error: validation.error
      });
      if (validation.ok) {
        return {
          outputMode: "json",
          sceneJsonString: commandResult.sceneJsonString,
          steps,
          agentUsed: true,
          iterativeApplied: true,
          tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
        };
      }
      lastError = validation.error || "Scene JSON validation failed.";
      continue;
    }

    if (commandResult.outputMode === "patch") {
      commandResult = { ...commandResult, commands: commandsFromPatchResult(commandResult) };
    }

    const commands = commandResult.commands;
    const modelSaysDone = commandScriptIndicatesDone(lastRawContent);
    const modelRequestsContinuation = commandScriptRequestsContinuation(lastRawContent);
    const responseWasCutOff = completionReasonIndicatesCutoff(commandResult.finishReason);
    if (commandListIsEmptyOrCommentsOnly(commands) && modelSaysDone) {
      // Do not let a follow-up `# done` erase evidence that the preceding command batch reported
      // success but left the exported scene unchanged. Give the model another repair opportunity;
      // if the guard is exhausted the caller will enter its verified JSON-Patch/full-JSON fallback.
      if (priorRoundError && appliedRounds === 0) {
        lastError = priorRoundError;
        steps.push({ kind: "refine_done", round: refineRound, ok: false, error: priorRoundError });
        continue;
      }
      steps.push({ kind: "refine_done", round: refineRound, ok: true, appliedRounds });
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: true,
        completed: true,
        stopReason: "model_done",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
    if (commandListIsEmptyOrCommentsOnly(commands)) {
      lastError = "Output mutating commands or # done when finished.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

    const dryRun = await dryRunUpdateCommands(commands, baseContext.currentSceneJsonString);
    if (!dryRun.ok) {
      const fail = dryRun.results?.find((item) => !item.ok);
      lastError = fail?.error || "Command dry-run failed.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

    const readOnly = !commandListHasMutatingOp(commands);
    const mutatingSignature = readOnly ? "" : JSON.stringify(commands);
    if (mutatingSignature && mutatingSignature === previousMutatingSignature) {
      steps.push({ kind: "refine_done", round: refineRound, ok: true, appliedRounds, reason: "repeated_output" });
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: appliedRounds > 0,
        completed: true,
        stopReason: "repeated_output",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
    const sceneSignatureBeforeApply = normalizedSceneSignature(baseContext.currentSceneJsonString);
    chatOptions?.signal?.throwIfAborted?.();
    const applied = await applyCommands(commands, {
      round: refineRound,
      readOnly,
      label: `AI Agent round ${refineRound}`
    });
    if (!applied.ok) {
      lastError = applied.error || "Command apply failed.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

    if (applied.objectGetFeedback) {
      baseContext.objectGetFeedback = [baseContext.objectGetFeedback, applied.objectGetFeedback]
        .filter(Boolean)
        .join("\n\n");
    }

    const fresh = await refreshContext();
    if (fresh && typeof fresh === "object") {
      Object.assign(baseContext, fresh);
    }
    const hasFreshSceneJson = typeof baseContext.currentSceneJsonString === "string";
    const sceneUnchanged = !readOnly && hasFreshSceneJson &&
      normalizedSceneSignature(baseContext.currentSceneJsonString) === sceneSignatureBeforeApply;
    const verifiedSceneMutation = !readOnly && (
      hasFreshSceneJson ? !sceneUnchanged : applied.sceneMutated === true
    );

    if (readOnly) {
      steps.push({ kind: "explore", round: refineRound, ok: true, count: commands.length });
      continue;
    }

    if (!verifiedSceneMutation) {
      previousMutatingSignature = mutatingSignature;
      lastError = "The command batch reported success, but the refreshed scene JSON did not change.";
      steps.push({ kind: "refine_apply", round: refineRound, ok: false, count: commands.length, error: lastError });
      continue;
    }

    previousMutatingSignature = mutatingSignature;
    appliedRounds += 1;
    anySceneMutated = true;
    appliedCommands.push(...commands);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "commands_applied",
        round: refineRound,
        message: `Applied round ${refineRound} to scene.`,
        sceneMutated: true
      },
      onProgress
    );

    if (hasFreshSceneJson) {
      emitStagePreview({
        sceneJsonString: baseContext.currentSceneJsonString,
        onProgress,
        getStepIndex,
        setStepIndex,
        stage: "adjustment_refinement",
        round: refineRound,
        maxRounds: maxRefineRounds,
        commands,
        outputMode: commandResult.outputMode,
        message: `Adjustment refinement preview ${refineRound}.`
      });
    }

    steps.push({
      kind: "refine_apply",
      round: refineRound,
      ok: true,
      count: commands.length
    });

    if (modelSaysDone) {
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: appliedRounds > 0,
        completed: true,
        stopReason: "model_done",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }

    if (!modelRequestsContinuation && !responseWasCutOff) {
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: true,
        execOk: true,
        completed: true,
        stopReason: "implicit_complete",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
  }

  if (appliedRounds > 0) {
    return {
      outputMode: "commands",
      commands: appliedCommands,
      steps,
      agentUsed: true,
      iterativeApplied: true,
      skipFinalExec: true,
      appliedRounds,
      sceneMutated: anySceneMutated,
      execOk: true,
      completed: false,
      stopReason: "budget_exhausted",
      tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
    };
  }

  throw new Error(lastError || "Iterative agent finished without applying changes.");
}

async function runAutomaticDraftRefinement(params) {
  const {
    userPrompt,
    initialSceneJsonString,
    preset,
    chatOptions,
    onProgress,
    steps,
    getStepIndex,
    setStepIndex,
    applyDraftCommands,
    maxRounds,
    refinementGoals = []
  } = params;
  let current = initialSceneJsonString;
  let feedback = "";
  let completed = false;
  let stopReason = "budget_exhausted";
  let previousOutputSignature = "";

  for (let round = 1; round <= maxRounds; round += 1) {
    chatOptions?.signal?.throwIfAborted?.();
    setStepIndex(getStepIndex() + 1);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "draft_refinement",
        round,
        maxRounds,
        message: `Improving the draft (step ${round})...`
      },
      onProgress
    );

    let refinement;
    try {
      const currentScene = parseSceneJsonString(current);
      const spatial = buildObjectSpatialCardsFromSceneJson(currentScene);
      const sceneScaleProfile = buildSceneScaleProfile(spatial.cards, spatial);
      const context = {
        currentSceneJsonString: current,
        objectSpatialCards: spatial.cards,
        sceneScaleProfile
      };
      context.userMessage = [
        buildSceneCommandUpdateUserMessage({
          modificationRequest: userPrompt,
          objectSpatialCards: spatial.cards,
          sceneScaleProfile,
          singleRound: false,
          agentRound: true
        }),
        refinementGoals.length
          ? `Concrete refinement goals (finish as many as possible now; do not invent extra goals):\n${refinementGoals.map((goal) => `- ${goal}`).join("\n")}`
          : "Complete only meaningful work still required by the original request; do not add ceremonial polish or review-only changes.",
        feedback ? `Previous refinement feedback:\n${feedback}` : ""
      ].filter(Boolean).join("\n\n");
      refinement = await requestUpdatedSceneEditCommands(userPrompt, context, {
        ...chatOptions,
        outputMode: "auto",
        fallbackToJson: false,
        agentRound: true,
        iterativeApply: true,
        singleRound: false,
        maxTokens: preset.repairMaxTokens || preset.generateMaxTokens
      });
    } catch (error) {
      feedback = String(error?.message || error);
      steps.push({ kind: "draft_refinement", round, ok: false, error: feedback });
      continue;
    }

    const rawRefinement = String(refinement.rawContent || refinement.commandScript || "");
    const modelSaysDone = commandScriptIndicatesDone(rawRefinement);
    if (
      refinement.outputMode === "done" ||
      (refinement.outputMode === "commands" && commandListIsEmptyOrCommentsOnly(refinement.commands) && modelSaysDone)
    ) {
      steps.push({ kind: "draft_refinement_done", round, ok: true });
      completed = true;
      stopReason = "model_done";
      break;
    }

    const outputSignature = rawRefinement.trim() || JSON.stringify(refinement.commands || refinement.patch || []);
    if (outputSignature && outputSignature === previousOutputSignature) {
      steps.push({ kind: "draft_refinement_done", round, ok: true, reason: "repeated_output" });
      completed = true;
      stopReason = "repeated_output";
      break;
    }
    previousOutputSignature = outputSignature;

    let candidate = refinement.sceneJsonString || "";
    if (refinement.outputMode === "commands") {
      try {
        if (typeof applyDraftCommands !== "function") {
          throw new Error("This host cannot execute command refinements; return JSON Patch instead.");
        }
        chatOptions?.signal?.throwIfAborted?.();
        const applied = await applyDraftCommands(refinement.commands, {
          round,
          sceneJsonString: current,
          commandScript: refinement.commandScript
        });
        candidate =
          typeof applied === "string"
            ? applied
            : String(applied?.sceneJsonString || "");
        if (applied && typeof applied === "object" && applied.ok === false) {
          throw new Error(applied.error || "Draft refinement commands failed.");
        }
      } catch (error) {
        feedback = String(error?.message || error);
        steps.push({
          kind: "draft_refinement",
          round,
          outputMode: "commands",
          ok: false,
          error: feedback
        });
        continue;
      }
    }

    const knownAssetResult = applyKnownPlanetTextureDefaults(
      candidate,
      userPrompt,
      chatOptions?.onlineTextureHints === true
    );
    candidate = knownAssetResult.sceneJsonString;
    const validation = await validateSceneJsonWithNormalizer(candidate);
    steps.push({
      kind: "draft_refinement",
      round,
      outputMode: refinement.outputMode,
      count:
        refinement.outputMode === "commands"
          ? refinement.commands?.length
          : refinement.outputMode === "patch"
            ? refinement.patch?.length
            : undefined,
      ok: validation.ok,
      error: validation.error
    });
    if (!validation.ok) {
      feedback = validation.error || "Refined scene JSON is invalid.";
      continue;
    }

    if (normalizedSceneSignature(candidate) === normalizedSceneSignature(current)) {
      steps.push({ kind: "draft_refinement_done", round, ok: true, reason: "no_change" });
      completed = true;
      stopReason = "no_change";
      break;
    }

    current = candidate;
    feedback = "The previous refinement was applied successfully. Continue only if another meaningful improvement is needed.";
    emitStagePreview({
      sceneJsonString: current,
      onProgress,
      getStepIndex,
      setStepIndex,
      stage: "draft_refinement",
      round,
      maxRounds,
      commands:
        refinement.outputMode === "commands" && knownAssetResult.applied.length === 0
          ? refinement.commands
          : undefined,
      outputMode: knownAssetResult.applied.length > 0 ? "json" : refinement.outputMode,
      message: `Draft refinement preview ${round} (${refinement.outputMode}).`
    });
    if (modelSaysDone) {
      steps.push({ kind: "draft_refinement_done", round, ok: true });
      completed = true;
      stopReason = "model_done";
      break;
    }
  }

  if (!completed) {
    steps.push({ kind: "draft_refinement_budget_exhausted", ok: true, maxRounds });
  }
  return { sceneJsonString: current, completed, stopReason };
}

/**
 * Repair/capability-review/layout-review all need to turn "here's what's wrong" into "here's a
 * fixed scene" — previously always via a full-scene-JSON rewrite (updateSceneJsonString). This
 * tries the same commands/JSON-Patch-preferring single round `requestSceneRefinementStep` uses
 * for draft refinement first (same LLM call count as before, just a cheaper/more targeted output
 * format when the model can manage it), and only falls back to the full-JSON rewrite — kept
 * available, just now the last resort — when that attempt throws or produces something invalid.
 * @param {string} fixPrompt describes the specific problem to fix
 * @param {string} sceneJsonString current (valid) scene JSON to fix
 * @param {{chatOptions: object, chatOptionsFullUpdate: object, applyDraftCommands?: Function, refineMaxTokens: number, fullRewriteMaxTokens: number}} config
 * @returns {Promise<string>}
 */
/**
 * Never throws (except on explicit user abort) — a capability/layout review round only ever
 * exists to *improve* an already-valid scene, so it must never be able to turn that valid scene
 * into a reported generation failure (timeout, transient network/provider error, empty response,
 * malformed fix — all just fall through to "keep what we had"). Same discipline as
 * sceneAiService.js's maybeApplyCapabilityReview, applied at this layer too.
 */
async function runTargetedFixRound(fixPrompt, sceneJsonString, config) {
  const { chatOptions, chatOptionsFullUpdate, applyDraftCommands, refineMaxTokens, fullRewriteMaxTokens } = config;
  try {
    const refinement = await requestSceneRefinementStep(fixPrompt, sceneJsonString, {
      ...chatOptions,
      allowCommands: typeof applyDraftCommands === "function",
      maxTokens: refineMaxTokens
    });
    if (refinement.outputMode === "done") {
      return sceneJsonString;
    }
    let candidate = refinement.sceneJsonString || "";
    if (refinement.outputMode === "commands") {
      const applied = await applyDraftCommands(refinement.commands, {
        sceneJsonString,
        commandScript: refinement.commandScript
      });
      candidate = typeof applied === "string" ? applied : String(applied?.sceneJsonString || "");
      if (applied && typeof applied === "object" && applied.ok === false) {
        throw new Error(applied.error || "Targeted fix commands failed.");
      }
    }
    const validation = await validateSceneJsonWithNormalizer(candidate);
    if (!validation.ok) {
      throw new Error(validation.error || "Targeted fix produced invalid scene JSON.");
    }
    return candidate;
  } catch (error) {
    if (chatOptions?.signal?.aborted) {
      throw error;
    }
    try {
      return await updateSceneJsonString(fixPrompt, sceneJsonString, {
        ...chatOptionsFullUpdate,
        maxTokens: fullRewriteMaxTokens
      });
    } catch (fallbackError) {
      if (chatOptionsFullUpdate?.signal?.aborted) {
        throw fallbackError;
      }
      return sceneJsonString;
    }
  }
}

/**
 * The outline is a cheap, best-effort planning aid, not a required step — a failure here (empty
 * response, transient network/provider error) must never abort the whole turn before a single
 * scene JSON call has even been attempted. Never throws except on explicit user abort; returns ""
 * (no outline) on any other failure so the caller just proceeds without one.
 */
async function requestOptionalOutline({ prompt, mode }, chatOptions, maxTokens) {
  try {
    return await requestSceneOutline({ prompt, mode }, { ...chatOptions, maxTokens });
  } catch (error) {
    if (chatOptions?.signal?.aborted) {
      throw error;
    }
    return "";
  }
}

/**
 * @param {object} input
 * @param {string} input.mode generate | update | fromImage
 * @param {string} [input.prompt]
 * @param {string} [input.currentSceneJsonString]
 * @param {string|{base64:string,mimeType?:string}} [input.image]
 * @param {object} [options]
 * @param {object} [options.agent]
 * @param {((p: SceneAgentProgress) => void)} [options.onProgress]
 * @returns {Promise<{ sceneJsonString: string, steps: object[], agentUsed: boolean, tokenHint: object }>}
 */
async function runSceneAgent(input = {}, options = {}) {
  const mode = input.mode || "generate";
  const prompt = String(input.prompt || "").trim();
  const userRequest = extractUserRequest(prompt);
  const { maxRefineRounds } = normalizeAgentOptions(options.agent);
  const requestedExecutionMode = normalizeExecutionMode(options.executionMode ?? options.agent?.executionMode);
  const refinementGoals = Array.isArray(options.refinementGoals)
    ? [...new Set(options.refinementGoals.map((goal) => String(goal || "").trim()).filter(Boolean))].slice(0, 4)
    : [];
  // Fixed metadata label — there is no more "depth" concept to report (see the module docblock);
  // kept only so tokenHint's shape doesn't change for anything reading it.
  const depth = "standard";
  const onProgress = options.onProgress;
  const steps = [];
  let stepIndex = 0;
  const streamPreview = options.streamPreview === true;
  const requestedOutputFormat = options.outputFormat === "friendly" ? "friendly" : "standard";
  // Raw character streaming is kept only for the fallback non-iterative update runner. Folding it
  // into every nested call would garble outline, draft, refine and review responses together.
  const rawOnDelta = typeof options.onDelta === "function" ? options.onDelta : undefined;
  const chatTransport = {
    stream: options.stream === true,
    signal: options.signal,
    onDelta:
      streamPreview && typeof onProgress === "function"
        ? (previewDelta) => {
            emitProgress(
              { step: stepIndex, kind: "stream", message: "Streaming…", previewDelta },
              onProgress
            );
          }
        : undefined
  };
  const chatOptions = { ...options, ...chatTransport };
  const configuredTurnTimeoutMs = Number(options.turnTimeoutMs);
  if (!(Number.isFinite(Number(chatOptions.turnDeadlineAt)) && Number(chatOptions.turnDeadlineAt) > 0)) {
    const turnTimeoutMs = Number.isFinite(configuredTurnTimeoutMs) && configuredTurnTimeoutMs > 0
      ? Math.max(1000, Math.min(600000, Math.round(configuredTurnTimeoutMs)))
      : 180000;
    chatOptions.turnDeadlineAt = Date.now() + turnTimeoutMs;
  }
  const applyDraftCommands = options.applyDraftCommands;
  const textureOptions = options.texture || {};
  delete chatOptions.agent;
  delete chatOptions.onProgress;
  delete chatOptions.texture;
  delete chatOptions.streamPreview;
  delete chatOptions.applyDraftCommands;
  // Every agent step operates on the same standard scheme-B representation. A friendly
  // projection is applied only once, at the public return boundary.
  chatOptions.outputFormat = "standard";

  const projectFinalScene = (sceneJsonString) =>
    projectSceneJsonString(sceneJsonString, requestedOutputFormat);

  /** Lowest-priority fallback for repair/capability/layout fixes — a full-scene-JSON rewrite,
   * only reached when a targeted commands/patch fix (runTargetedFixRound below) isn't available
   * or doesn't work out. */
  const chatOptionsFullUpdate = { ...chatOptions, allowInvalidSceneDraft: true };
  delete chatOptionsFullUpdate.updateMode;

  /** Avoid duplicate capability review inside generate — this module's own capability-review
   * pass below (preset.runCapabilityReview) is the one that runs. */
  const chatOptionsGenerate = {
    ...chatOptions,
    capabilityReview: false,
    allowInvalidSceneDraft: true,
    planFirst: false,
    // SceneAgent emits the first validated, asset-normalized preview itself. Letting the lower
    // layer emit earlier would briefly render an untextured version and race the stage queue.
    onSceneDraft: undefined
  };

  const maybeFillTextures = async (sceneJsonString) => {
    if (!textureOptions.enabled) {
      return { sceneJsonString, textureFillWarning: undefined };
    }
    try {
      const sink = textureOptions.sink;
      const imageProvider =
        textureOptions.imageProvider ||
        (textureOptions.imageApiKey || chatOptions.apiKey
          ? createOpenAiImageProvider({
              apiKey:
                textureOptions.imageApiKey ||
                textureOptions.image?.apiKey ||
                chatOptions.apiKey,
              baseUrl: textureOptions.imageBaseUrl || textureOptions.image?.baseUrl || chatOptions.baseUrl,
              model:
                textureOptions.imageModel ||
                textureOptions.image?.model ||
                chatOptions.imageModel ||
                "dall-e-3"
            })
          : null);
      if (!imageProvider) {
        throw new Error(
          "texture.enabled requires imageProvider or apiKey (llm.apiKey / chat apiKey)."
        );
      }
      if (!sink?.saveLocal && !sink?.upload) {
        throw new Error(
          "texture.enabled requires sink.saveLocal or sink.upload (browser: directory/upload sink; external Node tools: core/util/nodeTextureSink)."
        );
      }
      stepIndex += 1;
      emitProgress(
        {
          step: stepIndex,
          kind: "fill_textures",
          message: "Filling textureUrl slots..."
        },
        onProgress
      );
      const filled = await fillTextureUrls(sceneJsonString, {
        userHint: userRequest,
        sink,
        imageProvider,
        projectRoot: textureOptions.projectRoot,
        overwriteExisting: Boolean(textureOptions.overwriteExisting),
        concurrency: textureOptions.concurrency ?? 2,
        chatOptions: {
          provider: chatOptions.provider,
          apiKey: chatOptions.apiKey,
           model: chatOptions.model,
           baseUrl: chatOptions.baseUrl,
           temperature: chatOptions.temperature,
           signal: chatOptions.signal,
           requestTimeoutMs: chatOptions.requestTimeoutMs,
           turnDeadlineAt: chatOptions.turnDeadlineAt
         }
       });
      steps.push({
        kind: "fill_textures",
        ok: true,
        applied: filled.taskResults?.length ?? 0,
        skipped: filled.skipped?.length ?? 0
      });
      return { sceneJsonString: filled.sceneJsonString, textureFillWarning: undefined };
    } catch (err) {
      steps.push({
        kind: "fill_textures",
        ok: false,
        error: String(err?.message || err)
      });
      return {
        sceneJsonString,
        textureFillWarning: String(err?.message || err)
      };
    }
  };

  const emitSceneReady = (sceneJsonString) => {
    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "scene_ready",
        message: "Scene JSON ready.",
        sceneJsonString
      },
      onProgress
    );
  };

  // Layout/material review is opt-in. Capability review is local-first and only spends another
  // model call when a concrete requested capability is missing.
  const configuredCommandMaxTokens = Number(
    options.commandMaxTokens ?? (mode === "update" ? options.maxTokens : NaN)
  );
  const preset = {
    maxSteps: maxRefineRounds,
    maxRefineRounds,
    outlineMaxTokens: OUTLINE_MAX_TOKENS,
    generateMaxTokens:
      requestedExecutionMode === "draft_refine"
        ? DRAFT_MAX_TOKENS
        : Number.isFinite(Number(options.maxTokens))
          ? Number(options.maxTokens)
          : FULL_REWRITE_MAX_TOKENS,
    repairMaxTokens: REFINE_ROUND_MAX_TOKENS,
    commandMaxTokens: Number.isFinite(configuredCommandMaxTokens)
      ? Math.max(512, Math.min(FULL_REWRITE_MAX_TOKENS, Math.round(configuredCommandMaxTokens)))
      : COMMAND_UPDATE_MAX_TOKENS,
    layoutReviewMaxTokens: REFINE_ROUND_MAX_TOKENS,
    reviewMaxTokens: 800,
    runOutline: requestedExecutionMode === "draft_refine",
    runRepair: true,
    runCapabilityReview: true,
    runLayoutReview: options.agent?.layoutReview === true,
    runTextureReview: false,
    maxCapabilityReviewAttempts: MAX_CAPABILITY_REVIEW_ATTEMPTS,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS
  };
  let outline = "";
  let sceneJsonString = "";
  let effectiveExecutionMode = requestedExecutionMode;

  const updateOutputMode = String(input.outputMode || options.outputMode || "json").toLowerCase();
  const commandUpdateModes = new Set(["commands", "auto"]);

  if (mode === "update" && commandUpdateModes.has(updateOutputMode)) {
    if (!prompt) {
      throw new Error("prompt is required for update mode.");
    }
    if (!input.currentSceneJsonString?.trim()) {
      throw new Error("currentSceneJsonString is required for update mode.");
    }

    if (preset.runOutline) {
      stepIndex += 1;
      emitProgress(
        { step: stepIndex, kind: "outline", message: "Planning scene outline..." },
        onProgress
      );
      outline = await requestOptionalOutline({ prompt: userRequest, mode }, chatOptions, preset.outlineMaxTokens);
      steps.push({ kind: "outline", ok: Boolean(outline), length: outline.length });
    }

    let commandStepIndex = stepIndex;
    const canIterate =
      typeof options.applyCommands === "function" && typeof options.refreshContext === "function";
    const commandRunner = canIterate
      ? runSceneAgentCommandsUpdateIterative
      : runSceneAgentCommandsUpdate;
    const commandResult = await commandRunner({
      userPrompt: userRequest,
      currentSceneJsonString: input.currentSceneJsonString,
      updateContext: input.updateContext || {},
      updateOutputMode,
      preset,
      outline,
      chatOptions: canIterate ? chatOptions : { ...chatOptions, onDelta: rawOnDelta },
      onProgress,
      steps,
      getStepIndex: () => commandStepIndex,
      setStepIndex: (value) => {
        commandStepIndex = value;
        stepIndex = value;
      },
      depth,
      validateCommands: options.validateCommands,
      applyCommands: options.applyCommands,
      refreshContext: options.refreshContext
    });

    stepIndex = commandStepIndex;

    if (commandResult.outputMode === "json") {
      emitSceneReady(commandResult.sceneJsonString);
      const fillResult = await maybeFillTextures(commandResult.sceneJsonString);
      return {
        ...commandResult,
        sceneJsonString: projectFinalScene(fillResult.sceneJsonString),
        textureFillWarning: fillResult.textureFillWarning,
        tokenHint: commandResult.tokenHint
      };
    }

    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "commands_ready",
        message: "Scene edit commands ready.",
        commands: commandResult.commands
      },
      onProgress
    );
    return {
      ...commandResult,
      textureFillWarning: undefined,
      tokenHint: commandResult.tokenHint
    };
  }

  if (preset.runOutline) {
    stepIndex += 1;
    emitProgress(
      { step: stepIndex, kind: "outline", message: "Planning scene outline..." },
      onProgress
    );
    outline = await requestOptionalOutline({ prompt: userRequest, mode }, chatOptions, preset.outlineMaxTokens);
    steps.push({ kind: "outline", ok: Boolean(outline), length: outline.length });
  }

  stepIndex += 1;
  emitProgress(
    { step: stepIndex, kind: "generate", message: "Generating full scene JSON..." },
    onProgress
  );

  // Resolved once for the whole agent run — see resolveAgentReferenceMaterial's docblock. Folded
  // directly into the plain-text prompt strings below (rather than a message-builder field) since
  // this generate/repair path already passes prompt as free text to generateSceneJsonString /
  // updateSceneJsonString.
  const referenceMaterial = await resolveAgentReferenceMaterial(userRequest, chatOptions);

  const buildInitialPrompt = () => {
    const draftHint =
      effectiveExecutionMode === "draft_refine" && (mode === "generate" || mode === "fromImage")
        ? "\n\nThis is the first usable structural draft of an incrementally built scene. Keep it compact, but include every primary subject, identity-defining bundled texture (especially named planets), requested primary animation, basic lighting, and a fitted camera now. Defer only secondary detail and large repeated populations; do not make a deliberately textureless placeholder."
        : "\n\nReturn the complete, immediately usable scene now. Include identity-defining textures, requested animation, lighting, and a fitted camera in this response; do not reserve ordinary work for later review rounds.";
    return (
      (outline && effectiveExecutionMode === "draft_refine" ? `${prompt}\n\nFollow this outline:\n${outline}` : prompt) +
      (mode === "generate" || mode === "fromImage" ? draftHint : "") +
      (referenceMaterial ? `\n\n${referenceMaterial}` : "")
    );
  };

  const generateInitialScene = async () => {
    const generatePrompt = buildInitialPrompt();
    const generationOptions = {
      ...chatOptionsGenerate,
      maxTokens: effectiveExecutionMode === "draft_refine" ? DRAFT_MAX_TOKENS : preset.generateMaxTokens,
      // SceneAgent has a better fallback than repeating another whole scene: one detected direct
      // cutoff switches to a small validated draft plus incremental commands immediately.
      compactRetryOnTruncation: false,
      segmentedOutput:
        effectiveExecutionMode === "draft_refine" ? false : chatOptionsGenerate.segmentedOutput
    };
    if (mode === "update") {
      return updateSceneJsonString(generatePrompt || prompt, input.currentSceneJsonString, generationOptions);
    }
    if (mode === "fromImage") {
      return generateSceneJsonFromImage(
        { prompt: generatePrompt || prompt || undefined, image: input.image },
        generationOptions
      );
    }
    return generateSceneJsonString(generatePrompt, generationOptions);
  };

  try {
    sceneJsonString = await generateInitialScene();
  } catch (error) {
    const canEscalate =
      effectiveExecutionMode === "direct" &&
      (mode === "generate" || mode === "fromImage") &&
      isSceneOutputLimitError(error);
    if (!canEscalate) throw error;

    effectiveExecutionMode = "draft_refine";
    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "execution_fallback",
        message: "The complete scene exceeded the provider output limit; switching to incremental construction."
      },
      onProgress
    );
    outline = await requestOptionalOutline({ prompt: userRequest, mode }, chatOptions, OUTLINE_MAX_TOKENS);
    steps.push({ kind: "execution_fallback", ok: true, reason: "output_limit" });
    steps.push({ kind: "outline", ok: Boolean(outline), length: outline.length });
    sceneJsonString = await generateInitialScene();
  }

  const knownAssetResult = applyKnownPlanetTextureDefaults(
    sceneJsonString,
    userRequest,
    chatOptions.onlineTextureHints === true
  );
  sceneJsonString = knownAssetResult.sceneJsonString;
  steps.push({
    kind: "generate",
    ok: true,
    executionMode: effectiveExecutionMode,
    knownAssetsApplied: knownAssetResult.applied.length
  });

  let validation = await validateSceneJsonWithNormalizer(sceneJsonString);
  if (validation.ok) {
    emitStagePreview({
      sceneJsonString,
      onProgress,
      getStepIndex: () => stepIndex,
      setStepIndex: (value) => {
        stepIndex = value;
      },
      stage: effectiveExecutionMode === "draft_refine" ? "initial_draft" : "direct_scene",
      message: effectiveExecutionMode === "draft_refine" ? "Initial draft ready." : "Scene preview ready."
    });
  }
  const maxRepairAttempts = preset.maxRepairAttempts ?? (preset.stopWhenValid ? 3 : 1);
  let repairAttempt = 0;
  while (!validation.ok && preset.runRepair && repairAttempt < maxRepairAttempts) {
    repairAttempt += 1;
    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "repair",
        attempt: repairAttempt,
        maxAttempts: maxRepairAttempts,
        error: validation.error,
        message: `Validation failed (attempt ${repairAttempt}/${maxRepairAttempts}): ${validation.error}`
      },
      onProgress
    );
    // Repair fixes genuinely invalid/malformed JSON — requestSceneRefinementStep (used by
    // runTargetedFixRound for capability/layout review below) is documented for refining an
    // already-*valid* draft and starts by re-parsing the current scene, so it isn't a good fit
    // here; a full-scene-JSON rewrite stays the direct, single-call repair path.
    const repairPrompt =
      `Fix the scene JSON so it is valid ThreeJSON. Previous error: ${validation.error}. User intent: ${userRequest}` +
      (referenceMaterial ? `\n\n${referenceMaterial}` : "");
    // A single flaky repair call (timeout, empty response) must not abort the whole turn — that
    // just means this attempt didn't help; the loop tries again (or exits and reports the last
    // real validation error below, same as if this attempt had returned invalid JSON).
    let repairedSceneJsonString = null;
    try {
      repairedSceneJsonString = await updateSceneJsonString(repairPrompt, sceneJsonString, {
        ...chatOptionsFullUpdate,
        maxTokens: preset.repairMaxTokens
      });
    } catch (error) {
      if (chatOptionsFullUpdate?.signal?.aborted) {
        throw error;
      }
      steps.push({ kind: "repair", attempt: repairAttempt, ok: false, error: String(error?.message || error) });
      continue;
    }
    sceneJsonString = applyKnownPlanetTextureDefaults(
      repairedSceneJsonString,
      userRequest,
      chatOptions.onlineTextureHints === true
    ).sceneJsonString;
    validation = await validateSceneJsonWithNormalizer(sceneJsonString);
    steps.push({
      kind: "repair",
      attempt: repairAttempt,
      ok: validation.ok,
      error: validation.error
    });
    if (validation.ok) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        stage: "repair",
        round: repairAttempt,
        maxRounds: maxRepairAttempts,
        message: `Repair preview (attempt ${repairAttempt}).`
      });
    }
    if (validation.ok && preset.stopWhenValid) {
      break;
    }
  }

  // Only genuinely incremental scenes enter the refine loop. Direct scenes finish after local
  // validation (plus a targeted capability fix only when a concrete requested feature is absent).
  let refinementCompleted = true;
  let refinementStopReason = effectiveExecutionMode === "direct" ? "direct_complete" : "model_done";
  if (
    validation.ok &&
    effectiveExecutionMode === "draft_refine" &&
    (mode === "generate" || mode === "fromImage")
  ) {
    const refinementResult = await runAutomaticDraftRefinement({
      userPrompt: userRequest || "Reconstruct and improve the scene represented by the reference image.",
      initialSceneJsonString: sceneJsonString,
      preset,
      chatOptions,
      onProgress,
      steps,
      getStepIndex: () => stepIndex,
      setStepIndex: (value) => {
        stepIndex = value;
      },
      applyDraftCommands,
      maxRounds: preset.maxRefineRounds,
      refinementGoals
    });
    sceneJsonString = refinementResult.sceneJsonString;
    refinementCompleted = refinementResult.completed;
    refinementStopReason = refinementResult.stopReason;
    validation = await validateSceneJsonWithNormalizer(sceneJsonString);
  }

  if (validation.ok && preset.runCapabilityReview) {
    const maxCapAttempts = preset.maxCapabilityReviewAttempts ?? 1;
    let capAttempt = 0;
    let capabilityFixApplied = false;
    while (capAttempt < maxCapAttempts) {
      const parsed = parseSceneJsonString(sceneJsonString);
      const fit = evaluateSceneCapabilityFit(userRequest, parsed);
      if (fit.ok) {
        steps.push({ kind: "capability_review", ok: true, matchedSignals: fit.matchedSignals });
        break;
      }
      capAttempt += 1;
      stepIndex += 1;
      emitProgress(
        {
          step: stepIndex,
          kind: "capability_review",
          attempt: capAttempt,
          maxAttempts: maxCapAttempts,
          message: `Capability fit review (attempt ${capAttempt}/${maxCapAttempts})...`
        },
        onProgress
      );
      const fixPrompt = buildCapabilityFixPrompt(userRequest, fit);
      const beforeFixSignature = normalizedSceneSignature(sceneJsonString);
      sceneJsonString = await runTargetedFixRound(fixPrompt, sceneJsonString, {
        chatOptions,
        chatOptionsFullUpdate,
        applyDraftCommands,
        refineMaxTokens: preset.repairMaxTokens || preset.generateMaxTokens,
        fullRewriteMaxTokens: FULL_REWRITE_MAX_TOKENS
      });
      sceneJsonString = applyKnownPlanetTextureDefaults(
        sceneJsonString,
        userRequest,
        chatOptions.onlineTextureHints === true
      ).sceneJsonString;
      capabilityFixApplied = normalizedSceneSignature(sceneJsonString) !== beforeFixSignature;
      validation = await validateSceneJsonWithNormalizer(sceneJsonString);
      const refit = validation.ok
        ? evaluateSceneCapabilityFit(userRequest, parseSceneJsonString(sceneJsonString))
        : null;
      steps.push({
        kind: "capability_review",
        attempt: capAttempt,
        ok: refit?.ok === true,
        gaps: fit.gaps,
        validationOk: validation.ok
      });
      if (!validation.ok) {
        break;
      }
      if (refit?.ok) {
        break;
      }
    }
    if (validation.ok && capabilityFixApplied) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        stage: "capability_review",
        message: "Capability review preview."
      });
    }
  }

  if (validation.ok && preset.runLayoutReview) {
    stepIndex += 1;
    const pointerSummary = listTexturePointersSummary(sceneJsonString);
    const capabilityFit = evaluateSceneCapabilityFit(userRequest, parseSceneJsonString(sceneJsonString));
    emitProgress(
      {
        step: stepIndex,
        kind: "layout_review",
        count: pointerSummary.count,
        message: `Layout/material review (${pointerSummary.count} texture slot(s))...`
      },
      onProgress
    );
    const reviewPrompt = buildLayoutReviewPrompt(
      sceneJsonString,
      userRequest,
      pointerSummary,
      capabilityFit
    );
    sceneJsonString = await runTargetedFixRound(reviewPrompt, sceneJsonString, {
      chatOptions,
      chatOptionsFullUpdate,
      applyDraftCommands,
      refineMaxTokens: preset.layoutReviewMaxTokens || preset.repairMaxTokens,
      fullRewriteMaxTokens: FULL_REWRITE_MAX_TOKENS
    });
    validation = await validateSceneJsonWithNormalizer(sceneJsonString);
    steps.push({ kind: "layout_review", ok: validation.ok, error: validation.error });
    if (validation.ok) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        stage: "layout_review",
        message: "Layout review preview."
      });
    }
  }

  if (preset.runTextureReview && validation.ok) {
    stepIndex += 1;
    const summary = listTexturePointersSummary(sceneJsonString);
    emitProgress(
      {
        step: stepIndex,
        kind: "texture_review",
        count: summary.count,
        message: `Found ${summary.count} textureUrl slot(s). Planning dry-run...`
      },
      onProgress
    );
    try {
      const dry = await planTexturesDry(sceneJsonString, userRequest, {
        ...chatOptions,
        maxTokens: preset.reviewMaxTokens || 800
      });
      steps.push({
        kind: "texture_review",
        ok: true,
        taskCount: dry.taskCount,
        note: dry.note
      });
    } catch (err) {
      steps.push({
        kind: "texture_review",
        ok: false,
        error: String(err?.message || err)
      });
    }
  }

  if (!validation.ok) {
    throw new Error(validation.error || "Scene JSON validation failed after agent run.");
  }

  if (preset.stopWhenValid && validation.ok) {
    steps.push({ kind: "complete", ok: true, depth });
  }

  emitSceneReady(sceneJsonString);
  const fillResult = await maybeFillTextures(sceneJsonString);

  return {
    sceneJsonString: projectFinalScene(fillResult.sceneJsonString),
    textureFillWarning: fillResult.textureFillWarning,
    steps,
    agentUsed: true,
    executionMode: effectiveExecutionMode,
    completed: refinementCompleted,
    stopReason: refinementStopReason,
    tokenHint: {
      rounds: stepIndex,
      depth,
      maxSteps: preset.maxSteps
    }
  };
}

export { runSceneAgent, normalizeAgentOptions };
