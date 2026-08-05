/**
 * Per-operation undo/redo stack, ported from tools/scene-host/editor/js/editorHistory.js's
 * past/future array design (state.past/state.future, maxDepth, push-clears-future). Only the stack
 * *mechanics* live here — entry semantics (what a "transform" or "objectSnapshot" entry means, how
 * to apply one) are the caller's concern (see useEditorApi.js's applyHistoryEntry), matching the
 * original's separation between editorHistory.js (the stack) and its many `apply*Entry` functions.
 *
 * Two of the original's five entry kinds are ported this phase: `objectSnapshot` (the original's
 * `objectObjJsonSnapshot` — full descriptor before/after for one object, covering every property-
 * and material-panel edit) and `transform` (the original's `objectDelta`/transform — before/after
 * position/rotation/scale for one object, covering gizmo drags). `objectAdd`/`objectRemove` have no
 * producer yet (object creation/deletion isn't built until phases 5/9); `sceneSnapshot` (the
 * original's whole-document fallback, used for its "Reset to bootstrap" feature and as a last-
 * resort replay when precise inversion fails) has no consumer yet either — this app resets history
 * outright on a full scene load (see useEditorApi.js's applyPayload) rather than pushing an
 * undoable entry for it, which is what the original does too for an ordinary open/import.
 *
 * Unlike the original's `historyMaxDepth` (settings-editable, applied live via
 * applySettingsFromEditor), maxDepth here is read once at mount from the settings store — updating
 * it while the app is running requires a reload. A reasonable simplification: depth only matters
 * once a session has accumulated many edits, and settings changes are infrequent.
 */
import { useCallback, useRef, useState } from "react";

export function useEditorHistory({ maxDepth = 50 } = {}) {
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [pastLen, setPastLen] = useState(0);
  const [futureLen, setFutureLen] = useState(0);

  const push = useCallback(
    (entry) => {
      if (!entry) {
        return;
      }
      pastRef.current.push(entry);
      while (pastRef.current.length > maxDepth) {
        pastRef.current.shift();
      }
      futureRef.current = [];
      setPastLen(pastRef.current.length);
      setFutureLen(0);
    },
    [maxDepth]
  );

  /** @param {(entry: object, direction: "undo") => Promise<boolean>} applyEntry */
  const undo = useCallback(async (applyEntry) => {
    const entry = pastRef.current.pop();
    if (!entry) {
      return { ok: false, error: "nothing to undo" };
    }
    setPastLen(pastRef.current.length);
    const ok = await applyEntry(entry, "undo");
    if (ok) {
      futureRef.current.push(entry);
      setFutureLen(futureRef.current.length);
    } else {
      // Failed to apply — put it back so the stack isn't silently corrupted.
      pastRef.current.push(entry);
      setPastLen(pastRef.current.length);
    }
    return { ok: Boolean(ok) };
  }, []);

  /** @param {(entry: object, direction: "redo") => Promise<boolean>} applyEntry */
  const redo = useCallback(
    async (applyEntry) => {
      const entry = futureRef.current.pop();
      if (!entry) {
        return { ok: false, error: "nothing to redo" };
      }
      setFutureLen(futureRef.current.length);
      const ok = await applyEntry(entry, "redo");
      if (ok) {
        pastRef.current.push(entry);
        while (pastRef.current.length > maxDepth) {
          pastRef.current.shift();
        }
        setPastLen(pastRef.current.length);
      } else {
        futureRef.current.push(entry);
        setFutureLen(futureRef.current.length);
      }
      return { ok: Boolean(ok) };
    },
    [maxDepth]
  );

  const clear = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    setPastLen(0);
    setFutureLen(0);
  }, []);

  return { push, undo, redo, clear, canUndo: pastLen > 0, canRedo: futureLen > 0 };
}
