/**
 * React binding for @threejson/player-kit's headless playlist store.
 *
 * The store is created once per hook instance and subscribed to via useSyncExternalStore, so any
 * component reading the playlist re-renders when entries or the current index change.
 *
 * Loading is intentionally left to the caller: the store moves the pointer, this hook hands you the
 * entry, and you decide how to play it. Pass `onActivate` to wire it to a player — typically
 * `useScenePlayer`'s loadFromUrl / loadFromFile — which keeps the playlist usable in contexts that
 * do not own a viewport at all.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { createPlaylistStore } from "@threejson/player-kit/js/createPlaylistStore.js";

/**
 * @param {object} [options]
 * @param {string} [options.storagePrefix] localStorage namespace (see createPlaylistStore).
 * @param {(url: string) => string} [options.resolveUrl] relative-URL rewriter.
 * @param {(entry: object) => void | Promise<void>} [options.onActivate] called with the entry
 *   whenever one becomes current — via `activate`, or via `restore` when `autoRestore` is on.
 * @param {boolean} [options.autoRestore] rehydrate from storage on mount (default: true).
 */
export function usePlaylist({
  storagePrefix,
  resolveUrl,
  onActivate,
  autoRestore = true
} = {}) {
  // Options are read through a latest-ref so a caller passing inline callbacks does not recreate the
  // store (which would drop the in-memory entries and re-hit IndexedDB on every render).
  const optionsRef = useRef({ onActivate });
  optionsRef.current = { onActivate };

  const store = useMemo(
    () => createPlaylistStore({ storagePrefix, resolveUrl }),
    // Intentionally constructed once: storagePrefix/resolveUrl are configuration, not reactive state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const activate = useCallback(
    async (index) => {
      const entry = store.activate(index);
      if (entry) {
        await optionsRef.current.onActivate?.(entry);
      }
      return entry;
    },
    [store]
  );

  const restoredRef = useRef(false);
  useEffect(() => {
    if (!autoRestore || restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    void (async () => {
      const { restored, index } = await store.restore();
      if (restored && index >= 0) {
        const entry = store.getEntries()[index];
        if (entry) {
          await optionsRef.current.onActivate?.(entry);
        }
      }
    })();
  }, [store, autoRestore]);

  const addUrl = useCallback((url, label) => store.addUrl(url, label), [store]);
  const addFile = useCallback((file) => store.addFile(file), [store]);

  const removeAt = useCallback(
    async (index) => {
      const result = await store.removeAt(index);
      // Removing the playing entry should start the replacement, so the viewport never shows a
      // scene that is no longer in the list.
      if (result.removedCurrent && result.nextIndex >= 0) {
        const entry = store.getEntries()[result.nextIndex];
        if (entry) {
          await optionsRef.current.onActivate?.(entry);
        }
      }
      return result;
    },
    [store]
  );

  const clear = useCallback((opts) => store.clear(opts), [store]);

  const next = useCallback(() => activate(snapshot.currentIndex + 1), [activate, snapshot.currentIndex]);
  const previous = useCallback(() => activate(snapshot.currentIndex - 1), [activate, snapshot.currentIndex]);

  return {
    entries: snapshot.entries,
    currentIndex: snapshot.currentIndex,
    current: snapshot.current,
    hasPrevious: snapshot.currentIndex > 0,
    hasNext: snapshot.currentIndex >= 0 && snapshot.currentIndex < snapshot.entries.length - 1,
    activate,
    next,
    previous,
    addUrl,
    addFile,
    removeAt,
    clear,
    store
  };
}
