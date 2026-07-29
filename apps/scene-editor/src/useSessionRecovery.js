/**
 * Session recovery: persist the working scene so a refresh or crash does not lose edits.
 *
 * Persists the *committed document* (the same canonical payload `commitRuntimeToDocument` produces),
 * not the live scene — so a restore is just `loadPayload` of a normal scene document, no special
 * rehydration path. Selection rides along so the user lands back on the object they were editing.
 *
 * Saves are debounced: a drag or a slider fires many commits in a second, and each one would
 * otherwise be its own IndexedDB write. The last state within the window wins, which is all recovery
 * needs.
 *
 * Degrades cleanly where IndexedDB is absent (SSR, some privacy modes): `ready` still resolves and
 * `saved` is null, so the app falls back to loading its default scene instead of failing to boot.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  editorSessionIdbGet,
  editorSessionIdbPut,
  editorSessionIdbDelete,
  EDITOR_SESSION_RECOVERY_KEY
} from "@threejson/host-kit/js/editorSessionIdb.js";

const SAVE_DEBOUNCE_MS = 600;
// Bump if the persisted shape changes, so an old snapshot from a previous format is ignored rather
// than restored into a shape the app no longer understands.
const SNAPSHOT_VERSION = 1;

export function useSessionRecovery() {
  const [saved, setSaved] = useState(null);
  const [ready, setReady] = useState(false);
  const available = typeof indexedDB !== "undefined";
  const timerRef = useRef(null);
  const pendingRef = useRef(null);

  // One-time load of any prior snapshot.
  useEffect(() => {
    let cancelled = false;
    if (!available) {
      setReady(true);
      return undefined;
    }
    void (async () => {
      try {
        const record = await editorSessionIdbGet(EDITOR_SESSION_RECOVERY_KEY);
        if (!cancelled) {
          // Ignore a snapshot from an incompatible version or one with no document.
          setSaved(record?.version === SNAPSHOT_VERSION && record?.payload ? record : null);
        }
      } catch {
        if (!cancelled) {
          setSaved(null);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [available]);

  const flush = useCallback(async () => {
    const snapshot = pendingRef.current;
    if (!available || !snapshot?.payload) {
      return;
    }
    try {
      await editorSessionIdbPut(EDITOR_SESSION_RECOVERY_KEY, {
        version: SNAPSHOT_VERSION,
        savedAt: Date.now(),
        ...snapshot
      });
    } catch {
      /* recovery is best-effort; a failed write must not surface to the user */
    }
  }, [available]);

  /** Debounced persist. Pass the committed document, current selection, and a label. */
  const save = useCallback(
    (snapshot) => {
      if (!available || !snapshot?.payload) {
        return;
      }
      pendingRef.current = snapshot;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [available, flush]
  );

  const clear = useCallback(async () => {
    clearTimeout(timerRef.current);
    pendingRef.current = null;
    setSaved(null);
    if (!available) {
      return;
    }
    try {
      await editorSessionIdbDelete(EDITOR_SESSION_RECOVERY_KEY);
    } catch {
      /* ignore */
    }
  }, [available]);

  // A pending save must survive the tab closing — flush synchronously-ish on the way out. The
  // debounce timer would otherwise be cancelled by unload before it fired.
  useEffect(() => {
    if (!available) {
      return undefined;
    }
    const onHide = () => {
      if (pendingRef.current) {
        void flush();
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [available, flush]);

  return { saved, ready, persistent: available, save, clear };
}
