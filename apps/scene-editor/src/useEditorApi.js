/**
 * Implements the `EditorApi` contract that @threejson/editor-kit's command layer is written
 * against (see editor-kit's lib/command/types.js), backed by a live @threejson/react player
 * runtime.
 *
 * This is the seam that makes the extracted command layer usable: editor-kit knows *what*
 * `editor.selection.set` / `editor.view.fit` / `editor.ingest` mean and how to validate and
 * dispatch them, but nothing about how this particular app stores selection or renders a scene.
 * The app supplies that here, and gets the whole command surface for free.
 *
 * Scope note: `undo`/`redo` are wired to a simple payload-snapshot stack rather than the original
 * editor's `editorHistory` (677 lines of per-object inverse operations, which is app-local and not
 * part of any package). It is honest history for whole-scene ingests, not per-property undo.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { createCommandContext, createCommandRegistry, executeCommand } from "threejson/core";
import { registerEditorCommands } from "@threejson/editor-kit/command";

export function useEditorApi(player) {
  const [selection, setSelectionState] = useState(null);
  const [log, setLog] = useState([]);
  const [payload, setPayload] = useState(null);
  // Incremented only after a scene has actually finished loading. Consumers that read the live
  // graph (the tree panel) must key off this, not off `payload`: applyPayload publishes the new
  // payload before awaiting the load, so a `payload`-keyed rebuild races ahead of the scene it is
  // meant to describe and renders an empty tree that nothing later invalidates.
  const [sceneVersion, setSceneVersion] = useState(0);

  const playerRef = useRef(player);
  playerRef.current = player;
  const payloadRef = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const selectionRef = useRef(null);
  selectionRef.current = selection;

  const appendLog = useCallback((entry) => {
    setLog((prev) => [...prev.slice(-199), { ...entry, at: Date.now() }]);
  }, []);

  const applyPayload = useCallback(
    async (next, { label } = {}) => {
      payloadRef.current = next;
      setPayload(next);
      await playerRef.current.loadFromPayload(next, { label });
      setSceneVersion((n) => n + 1);
    },
    []
  );

  const editorApi = useMemo(() => {
    const api = {
      getCommandContext() {
        const snap = playerRef.current.getSnapshot?.();
        return createCommandContext({
          scene: snap?.scene ?? null,
          camera: snap?.camera ?? null,
          renderer: snap?.renderer ?? null,
          controls: snap?.controls ?? null,
          document: payloadRef.current
        });
      },

      async ingest(nextPayload, options = {}) {
        try {
          if (!options.historyReplay && payloadRef.current) {
            undoStack.current.push(payloadRef.current);
            redoStack.current.length = 0;
          }
          await applyPayload(nextPayload, { label: options.label });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error?.message || error) };
        }
      },

      getSelection() {
        return selectionRef.current;
      },

      setSelection(id) {
        setSelectionState(id ?? null);
        return { ok: true };
      },

      async undo() {
        const prev = undoStack.current.pop();
        if (!prev) {
          return { ok: false };
        }
        if (payloadRef.current) {
          redoStack.current.push(payloadRef.current);
        }
        await applyPayload(prev, { label: "undo" });
        return { ok: true };
      },

      async redo() {
        const next = redoStack.current.pop();
        if (!next) {
          return { ok: false };
        }
        if (payloadRef.current) {
          undoStack.current.push(payloadRef.current);
        }
        await applyPayload(next, { label: "redo" });
        return { ok: true };
      },

      fitView() {
        playerRef.current.fitViewToSceneBounds();
        return { ok: true };
      },

      async execCoreCommands(input, options = {}) {
        const ctx = api.getCommandContext();
        const result = await executeCommand(ctx, input, { ...options, registry });
        return { ok: result?.ok !== false, results: [result] };
      }
    };
    return api;
  }, [applyPayload]);

  // One registry per app instance, seeded with the core commands and then extended with
  // editor-kit's editor.* surface bound to the EditorApi above.
  const registry = useMemo(() => {
    const reg = createCommandRegistry();
    registerEditorCommands(reg, editorApi);
    return reg;
  }, [editorApi]);

  /**
   * Folds runtime edits back into the source document.
   *
   * Core mutations (`object.patch`, `material.patch`) apply to the live scene and do **not** write
   * through to the payload the scene was loaded from. Left alone that has two consequences: the
   * edits vanish on any reload, and history is a lie — an "undo" that re-ingests the untouched
   * document appears to work only because it throws the runtime edits away, while redo has nothing
   * to reapply. Re-serialising the scene after each edit makes the document authoritative again, so
   * both directions of history operate on real before/after states.
   *
   * Cost is a full scene serialisation per edit. Acceptable for an editor; the alternative is
   * per-property inverse operations (the original editor's editorHistory).
   */
  const commitRuntimeToDocument = useCallback(async () => {
    const ctx = editorApi.getCommandContext();
    const result = await executeCommand(ctx, { op: "scene.export", args: { format: "standard" } }, { registry });
    const next = result?.data?.json;
    if (result?.ok === false || !next) {
      return false;
    }
    // Update the document only — reloading here would throw away the very edit being committed.
    payloadRef.current = next;
    setPayload(next);
    return true;
  }, [editorApi, registry]);

  /**
   * Records the current document so the next mutation can be undone.
   *
   * Core mutations (`object.patch`, `material.patch`, …) edit `ctx.document` — which *is*
   * payloadRef.current — in place, and they do not go through `ingest`, so nothing would otherwise
   * reach the undo stack. Callers about to mutate should snapshot first. The clone is essential:
   * keeping the same reference would push an object that the patch then edits underneath us,
   * making undo a no-op.
   *
   * This is whole-document undo, not the original editor's per-property inverse operations, so an
   * undo reloads the scene. Correct, and coarser than the original.
   */
  const beginHistoryStep = useCallback(() => {
    const current = payloadRef.current;
    if (!current) {
      return;
    }
    const copy =
      typeof structuredClone === "function" ? structuredClone(current) : JSON.parse(JSON.stringify(current));
    undoStack.current.push(copy);
    redoStack.current.length = 0;
  }, []);

  /**
   * Runs a structured command ({ op, args }) through the registry.
   *
   * Preferred over the text form for anything built from data rather than typed by a user: the
   * micro-DSL is whitespace-separated `key=value`, so an object name containing a space — or any
   * value needing quoting — cannot survive the round-trip. `quiet` keeps high-frequency reads
   * (the inspector refetches on every selection) out of the user-facing console.
   */
  const runCommandObject = useCallback(
    async (op, args = {}, { quiet = false } = {}) => {
      if (!quiet) {
        appendLog({ kind: "in", text: `${op} ${JSON.stringify(args)}` });
      }
      try {
        const ctx = editorApi.getCommandContext();
        const result = await executeCommand(ctx, { op, args }, { registry });
        if (!quiet) {
          appendLog({ kind: result?.ok === false ? "err" : "out", text: JSON.stringify(result) });
        } else if (result?.ok === false) {
          // Failures always surface, even for quiet reads — a silently broken inspector is worse
          // than a noisy console.
          appendLog({ kind: "err", text: `${op}: ${result?.error || "failed"}` });
        }
        return result;
      } catch (error) {
        appendLog({ kind: "err", text: String(error?.message || error) });
        return null;
      }
    },
    [editorApi, registry, appendLog]
  );

  /** Runs a command line (e.g. `editor.view.fit`) through the registry. */
  const runCommand = useCallback(
    async (line) => {
      const text = String(line || "").trim();
      if (!text) {
        return null;
      }
      appendLog({ kind: "in", text });
      try {
        const ctx = editorApi.getCommandContext();
        const result = await executeCommand(ctx, text, { registry });
        appendLog({ kind: result?.ok === false ? "err" : "out", text: JSON.stringify(result) });
        return result;
      } catch (error) {
        appendLog({ kind: "err", text: String(error?.message || error) });
        return null;
      }
    },
    [editorApi, registry, appendLog]
  );

  return {
    editorApi,
    registry,
    runCommand,
    runCommandObject,
    beginHistoryStep,
    commitRuntimeToDocument,
    log,
    clearLog: () => setLog([]),
    selection,
    setSelection: (id) => setSelectionState(id ?? null),
    payload,
    sceneVersion,
    loadPayload: (next, opts) => editorApi.ingest(next, opts),
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    undo: () => editorApi.undo(),
    redo: () => editorApi.redo()
  };
}
