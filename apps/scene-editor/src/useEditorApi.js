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
 * Undo/redo is a per-operation inverse stack (useEditorHistory.js, ported from the original
 * editor's editorHistory.js), not a whole-document snapshot: each object edit records that one
 * object's before/after state, and undo/redo re-applies just that object via `object.patch`. A
 * full scene load (open/import/restore) resets the stack outright rather than pushing an entry —
 * see applyPayload — matching the original's behavior for an ordinary scene open.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { createCommandContext, createCommandRegistry, executeCommand } from "threejson/core";
import { registerEditorCommands } from "@threejson/editor-kit/command";
import { useEditorHistory } from "./lib/useEditorHistory.js";
import { getEditorSettings } from "./lib/useEditorSettings.js";

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
  const history = useEditorHistory({
    maxDepth: Math.min(500, Math.max(1, Math.round(Number(getEditorSettings().editing.historyMaxDepth) || 50)))
  });
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

  // applyHistoryEntry needs `registry`/`commitRuntimeToDocument`, both defined after `editorApi` —
  // and `editorApi.undo`/`redo` (part of the EditorApi contract editor-kit's command layer calls)
  // are fixed once at editorApi's creation. The ref indirection lets `editorApi.undo/redo` always
  // reach the *current* applyHistoryEntry closure without editorApi itself needing to be recreated
  // every render (which would also recreate `registry`, tearing down registered commands).
  const applyHistoryEntryRef = useRef(null);

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
          await applyPayload(nextPayload, { label: options.label });
          // A full load opens a (possibly different) scene — matches the original editor's
          // resetForFullSceneLoad: history is per-scene, not carried across an open/import/restore.
          history.clear();
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
        return history.undo((entry, direction) => applyHistoryEntryRef.current?.(entry, direction));
      },

      async redo() {
        return history.redo((entry, direction) => applyHistoryEntryRef.current?.(entry, direction));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
   * edits vanish on any reload, and export/session-recovery would see stale data. Re-serialising
   * the scene after each edit makes the document authoritative again. Undo/redo no longer depends
   * on this for its own correctness (each history entry carries its own before/after state), but
   * export, autosave, and the "committed document" concept it backs still do.
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
   * Applies one history entry's before/after state to its target object via `object.patch`,
   * mirroring the original editor's applyTransformEntry/applyObjJsonSnapshotEntry: only the one
   * object named by the entry is touched, not the whole document. `object.patch`'s
   * `options.autoRedeploy` (on by default) handles the original's manual needsRedeploy/
   * redeployObject step.
   */
  applyHistoryEntryRef.current = async (entry, direction) => {
    if (entry?.kind !== "objectSnapshot" && entry?.kind !== "transform") {
      return false;
    }
    const target = direction === "undo" ? entry.before : entry.after;
    if (!target) {
      return false;
    }
    const label = direction === "undo" ? "撤销" : "重做";
    appendLog({ kind: "in", text: `${label}: ${entry.label || entry.kind} (${entry.threeJsonId})` });
    const ctx = editorApi.getCommandContext();
    const result = await executeCommand(
      ctx,
      { op: "object.patch", args: { id: entry.threeJsonId, partial: target } },
      { registry }
    );
    if (result?.ok === false) {
      appendLog({ kind: "err", text: `${label} failed: ${result?.error || "object.patch failed"}` });
      return false;
    }
    await commitRuntimeToDocument();
    setSelectionState(entry.threeJsonId);
    appendLog({ kind: "out", text: JSON.stringify(result) });
    return true;
  };

  /** Records one object's before/after descriptor (or transform) onto the undo stack. */
  const pushHistoryEntry = useCallback(
    (entry) => {
      history.push(entry);
    },
    [history]
  );

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
    commitRuntimeToDocument,
    pushHistoryEntry,
    log,
    clearLog: () => setLog([]),
    selection,
    setSelection: (id) => setSelectionState(id ?? null),
    payload,
    sceneVersion,
    loadPayload: (next, opts) => editorApi.ingest(next, opts),
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undo: () => editorApi.undo(),
    redo: () => editorApi.redo()
  };
}
