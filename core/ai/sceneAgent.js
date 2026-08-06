/**
 * Scene agent: always draft-then-incrementally-refine. There is no more "single-turn vs
 * multi-turn agent" distinction — a one-shot full-JSON generation is exactly the pattern that
 * made large/complex scenes truncate or fail, so it is no longer a mode you can opt into or out
 * of here. What used to be depth-gated ("simple"/"medium"/"deep"/"auto" — see the now-removed
 * agentDepth.js) is now a single user-configurable round budget (see normalizeAgentOptions
 * below): the model can always finish early via `# done`, the cap only guards against a runaway
 * loop.
 *
 * Two distinct round loops remain (deliberately not merged into one implementation): `generate`
 * mode's post-draft elaboration goes through runOptionalDraftRefinement (full-scene-context,
 * commands/patch/full-JSON/done cascade, works with or without a live runtime); `update`/adjust
 * mode's editing loop goes through runSceneAgentCommandsUpdateIterative (cheap spatial-summary
 * context, richer exploration/validation hooks tailored to editing an existing live scene). They
 * share the same round-budget setting and the same patch handling (commandsFromPatchResult).
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
  commandScriptIndicatesDone
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
/** Only reached when a round has no incremental-apply mechanism available at all (bare `core/ai`
 * callers with no live/offscreen runtime) — the lowest-priority fallback, not the common path. */
const FULL_REWRITE_MAX_TOKENS = 6000;
/** Generous default so a complex scene has real room to converge — the model can always finish
 * earlier via `# done`; this only guards against never finishing. User-configurable per host
 * settings (e.g. ThreeBox's `ai.maxAutoRefineRounds`), clamped to HARD_MAX_REFINE_ROUNDS. */
const DEFAULT_MAX_REFINE_ROUNDS = 20;
/** Hard ceiling enforced regardless of what a caller/user configures — a stuck loop (model never
 * emits `# done`) must still terminate. */
const HARD_MAX_REFINE_ROUNDS = 60;
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
function emitStagePreview({ sceneJsonString, onProgress, getStepIndex, setStepIndex, message }) {
  if (!sceneJsonString?.trim()) {
    return;
  }
  setStepIndex(getStepIndex() + 1);
  emitProgress(
    {
      step: getStepIndex(),
      kind: "stage_preview",
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
        maxTokens: isRepair ? preset.repairMaxTokens : preset.generateMaxTokens
      });
    } catch (err) {
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
  let lastCommands = [];

  // Resolved once for the whole turn — see runSceneAgentCommandsUpdate's matching comment.
  const referenceMaterial = await resolveAgentReferenceMaterial(userPrompt, chatOptions);

  for (let refineRound = 1; refineRound <= maxRefineRounds; refineRound += 1) {
    setStepIndex(getStepIndex() + 1);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "refine",
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
        maxTokens: preset.generateMaxTokens
      });
    } catch (err) {
      lastError = String(err?.message || err);
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

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
    if (commandScriptIndicatesDone(lastRawContent)) {
      steps.push({ kind: "refine_done", round: refineRound, ok: true, appliedRounds });
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: lastCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: true,
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

    if (!readOnly) {
      appliedRounds += 1;
      lastCommands = commands;
      anySceneMutated = anySceneMutated || applied.sceneMutated === true;
      emitProgress(
        {
          step: getStepIndex(),
          kind: "commands_applied",
          round: refineRound,
          message: `Applied round ${refineRound} to scene.`,
          sceneMutated: applied.sceneMutated === true
        },
        onProgress
      );
    }

    const fresh = await refreshContext();
    if (fresh && typeof fresh === "object") {
      Object.assign(baseContext, fresh);
    }

    steps.push({
      kind: readOnly ? "explore" : "refine_apply",
      round: refineRound,
      ok: true,
      count: commands.length
    });

    if (commandScriptIndicatesDone(lastRawContent)) {
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: lastCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: appliedRounds > 0,
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
  }

  if (appliedRounds > 0) {
    return {
      outputMode: "commands",
      commands: lastCommands,
      steps,
      agentUsed: true,
      iterativeApplied: true,
      skipFinalExec: true,
      appliedRounds,
      sceneMutated: anySceneMutated,
      execOk: true,
      tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
    };
  }

  throw new Error(lastError || "Iterative agent finished without applying changes.");
}

async function runOptionalDraftRefinement(params) {
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
    maxRounds
  } = params;
  let current = initialSceneJsonString;
  let feedback = "";

  for (let round = 1; round <= maxRounds; round += 1) {
    setStepIndex(getStepIndex() + 1);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "draft_refinement",
        message: `Optional draft refinement ${round}/${maxRounds}...`
      },
      onProgress
    );

    let refinement;
    try {
      refinement = await requestSceneRefinementStep(userPrompt, current, {
        ...chatOptions,
        feedback,
        allowCommands: typeof applyDraftCommands === "function",
        maxTokens: preset.repairMaxTokens || preset.generateMaxTokens
      });
    } catch (error) {
      feedback = String(error?.message || error);
      steps.push({ kind: "draft_refinement", round, ok: false, error: feedback });
      continue;
    }

    if (refinement.outputMode === "done") {
      steps.push({ kind: "draft_refinement_done", round, ok: true });
      break;
    }

    let candidate = refinement.sceneJsonString || "";
    if (refinement.outputMode === "commands") {
      try {
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

    current = candidate;
    feedback = "The previous refinement was applied successfully. Continue only if another meaningful improvement is needed.";
    emitStagePreview({
      sceneJsonString: current,
      onProgress,
      getStepIndex,
      setStepIndex,
      message: `Draft refinement preview ${round} (${refinement.outputMode}).`
    });
  }

  return current;
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
  } catch (_error) {
    return updateSceneJsonString(fixPrompt, sceneJsonString, {
      ...chatOptionsFullUpdate,
      maxTokens: fullRewriteMaxTokens
    });
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
  const { maxRefineRounds } = normalizeAgentOptions(options.agent);
  // Fixed metadata label — there is no more "depth" concept to report (see the module docblock);
  // kept only so tokenHint's shape doesn't change for anything reading it.
  const depth = "standard";
  const onProgress = options.onProgress;
  const steps = [];
  let stepIndex = 0;
  const streamPreview = options.streamPreview === true;
  const requestedOutputFormat = options.outputFormat === "friendly" ? "friendly" : "standard";
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
        : options.onDelta
  };
  const chatOptions = { ...options, ...chatTransport };
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
    planFirst: false
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
        userHint: prompt,
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
          temperature: chatOptions.temperature
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

  // Every LLM round now flows through the pipeline below — there is no more one-shot bypass to
  // fall back to (see the module docblock). `preset` is a fixed policy object rather than a
  // depth-derived lookup: the only thing that's actually user-configurable now is the refine
  // round budget (maxRefineRounds), everything else here is a stable default.
  const preset = {
    maxSteps: maxRefineRounds,
    maxRefineRounds,
    outlineMaxTokens: OUTLINE_MAX_TOKENS,
    generateMaxTokens: DRAFT_MAX_TOKENS,
    repairMaxTokens: REFINE_ROUND_MAX_TOKENS,
    layoutReviewMaxTokens: REFINE_ROUND_MAX_TOKENS,
    reviewMaxTokens: 800,
    runOutline: true,
    runRepair: true,
    runCapabilityReview: true,
    runLayoutReview: true,
    runTextureReview: false,
    maxCapabilityReviewAttempts: MAX_CAPABILITY_REVIEW_ATTEMPTS,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS
  };
  let outline = "";
  let sceneJsonString = "";

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
      outline = await requestSceneOutline(
        { prompt, mode },
        {
          ...chatOptions,
          maxTokens: preset.outlineMaxTokens
        }
      );
      steps.push({ kind: "outline", ok: true, length: outline.length });
    }

    let commandStepIndex = stepIndex;
    // Iterative (apply-as-you-go, refresh context, ask again) is always preferred now — it's
    // strictly better than "collect one command batch and let the caller apply it once" (see the
    // module docblock). The only reason to fall back to the non-iterative runner is a caller that
    // hasn't wired up applyCommands/refreshContext at all (e.g. a bare core/ai script) —
    // runSceneAgentCommandsUpdateIterative itself requires both and throws without them.
    const canIterate = typeof options.applyCommands === "function" && typeof options.refreshContext === "function";
    const commandRunner = canIterate
      ? runSceneAgentCommandsUpdateIterative
      : runSceneAgentCommandsUpdate;
    const commandResult = await commandRunner({
      userPrompt: prompt,
      currentSceneJsonString: input.currentSceneJsonString,
      updateContext: input.updateContext || {},
      updateOutputMode,
      preset,
      outline,
      chatOptions,
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
    outline = await requestSceneOutline(
      { prompt, mode },
      {
        ...chatOptions,
        maxTokens: preset.outlineMaxTokens
      }
    );
    steps.push({ kind: "outline", ok: true, length: outline.length });
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
  const referenceMaterial = await resolveAgentReferenceMaterial(prompt, chatOptions);

  // Ask for a rough first pass, not the finished scene — the incremental refine loop right after
  // this (see the "Always elaborate the ... draft" block below) is what actually fills in detail,
  // a small step at a time, without ever risking an output-length truncation on a single call.
  const draftBlockoutHint =
    mode === "generate"
      ? "\n\nThis is a first pass, not the finished scene: give a small, structurally correct blockout — the right groups/objects roughly placed with simple geometry — and skip fine detail, secondary objects, and material/texture polish. Those will be added afterward in follow-up refinement rounds."
      : "";

  const generatePrompt =
    (outline && preset.runOutline ? `${prompt}\n\nFollow this outline:\n${outline}` : prompt) +
    draftBlockoutHint +
    (referenceMaterial ? `\n\n${referenceMaterial}` : "");

  if (mode === "update") {
    sceneJsonString = await updateSceneJsonString(
      generatePrompt || prompt,
      input.currentSceneJsonString,
      { ...chatOptionsGenerate, maxTokens: preset.generateMaxTokens }
    );
  } else if (mode === "fromImage") {
    sceneJsonString = await generateSceneJsonFromImage(
      { prompt: generatePrompt || prompt || undefined, image: input.image },
      { ...chatOptionsGenerate, maxTokens: preset.generateMaxTokens }
    );
  } else {
    sceneJsonString = await generateSceneJsonString(generatePrompt, {
      ...chatOptionsGenerate,
      maxTokens: preset.generateMaxTokens
    });
  }
  steps.push({ kind: "generate", ok: true });

  let validation = await validateSceneJsonWithNormalizer(sceneJsonString);
  if (validation.ok) {
    emitStagePreview({
      sceneJsonString,
      onProgress,
      getStepIndex: () => stepIndex,
      setStepIndex: (value) => {
        stepIndex = value;
      },
      message: "Initial draft ready."
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
        message: `Validation failed (attempt ${repairAttempt}/${maxRepairAttempts}): ${validation.error}`
      },
      onProgress
    );
    // Repair fixes genuinely invalid/malformed JSON — requestSceneRefinementStep (used by
    // runTargetedFixRound for capability/layout review below) is documented for refining an
    // already-*valid* draft and starts by re-parsing the current scene, so it isn't a good fit
    // here; a full-scene-JSON rewrite stays the direct, single-call repair path.
    const repairPrompt =
      `Fix the scene JSON so it is valid ThreeJSON. Previous error: ${validation.error}. User intent: ${prompt}` +
      (referenceMaterial ? `\n\n${referenceMaterial}` : "");
    sceneJsonString = await updateSceneJsonString(repairPrompt, sceneJsonString, {
      ...chatOptionsFullUpdate,
      maxTokens: preset.repairMaxTokens
    });
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
        message: `Repair preview (attempt ${repairAttempt}).`
      });
    }
    if (validation.ok && preset.stopWhenValid) {
      break;
    }
  }

  // Always elaborate the (deliberately small — see DRAFT_MAX_TOKENS) draft with incremental
  // commands/JSON-Patch rounds now — this is the actual fix for "one giant JSON call truncates on
  // a large scene": no single call after this point ever has to hold the whole finished scene,
  // detail accumulates one small step at a time (see the module docblock). There is no more
  // opt-in flag for this; it always runs for generate mode once a valid draft exists.
  if (validation.ok && mode === "generate") {
    sceneJsonString = await runOptionalDraftRefinement({
      userPrompt: prompt,
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
      maxRounds: preset.maxRefineRounds
    });
    validation = await validateSceneJsonWithNormalizer(sceneJsonString);
  }

  if (validation.ok && preset.runCapabilityReview) {
    const maxCapAttempts = preset.maxCapabilityReviewAttempts ?? 1;
    let capAttempt = 0;
    while (capAttempt < maxCapAttempts) {
      const parsed = parseSceneJsonString(sceneJsonString);
      const fit = evaluateSceneCapabilityFit(prompt, parsed);
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
          message: `Capability fit review (attempt ${capAttempt}/${maxCapAttempts})...`
        },
        onProgress
      );
      const fixPrompt = buildCapabilityFixPrompt(prompt, fit);
      sceneJsonString = await runTargetedFixRound(fixPrompt, sceneJsonString, {
        chatOptions,
        chatOptionsFullUpdate,
        applyDraftCommands,
        refineMaxTokens: preset.repairMaxTokens || preset.generateMaxTokens,
        fullRewriteMaxTokens: FULL_REWRITE_MAX_TOKENS
      });
      validation = await validateSceneJsonWithNormalizer(sceneJsonString);
      steps.push({
        kind: "capability_review",
        attempt: capAttempt,
        ok: fit.ok,
        gaps: fit.gaps,
        validationOk: validation.ok
      });
      if (!validation.ok) {
        break;
      }
      const refit = evaluateSceneCapabilityFit(prompt, parseSceneJsonString(sceneJsonString));
      if (refit.ok) {
        break;
      }
    }
    if (validation.ok) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        message: "Capability review preview."
      });
    }
  }

  if (validation.ok && preset.runLayoutReview) {
    stepIndex += 1;
    const pointerSummary = listTexturePointersSummary(sceneJsonString);
    const capabilityFit = evaluateSceneCapabilityFit(prompt, parseSceneJsonString(sceneJsonString));
    emitProgress(
      {
        step: stepIndex,
        kind: "layout_review",
        message: `Layout/material review (${pointerSummary.count} texture slot(s))...`
      },
      onProgress
    );
    const reviewPrompt = buildLayoutReviewPrompt(
      sceneJsonString,
      prompt,
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
        message: `Found ${summary.count} textureUrl slot(s). Planning dry-run...`
      },
      onProgress
    );
    try {
      const dry = await planTexturesDry(sceneJsonString, prompt, {
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
    tokenHint: {
      rounds: stepIndex,
      depth,
      maxSteps: preset.maxSteps
    }
  };
}

export { runSceneAgent, normalizeAgentOptions };
