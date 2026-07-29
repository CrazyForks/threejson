/**
 * Headless playlist model — the scene list, which entry is current, and its persistence.
 *
 * Ported from the playlist half of tools/scene-host/player/js/playerApp.js. This is state
 * management, not UI: it owns the entry array, the current index, the localStorage manifest, and
 * the IndexedDB blob storage for file entries. Rendering the list, its context menu, and any
 * transport chrome stays in the consuming app — matching the packages plan's split ("the IDB-storing
 * logic can go in the package; the top bar and settings modal stay in the app").
 *
 * It deliberately does NOT load scenes. `activate(index)` only moves the pointer and returns the
 * entry; the app decides what to do with it (normally hand it to a player runtime's loadFromUrl /
 * loadFromFile). That keeps the playlist reusable for a thumbnail grid, a queue widget, or a headless
 * batch job, none of which want a coupled load.
 *
 * Subscribe/getSnapshot are shaped for React's useSyncExternalStore (see @threejson/react's
 * usePlaylist), but the store itself is framework-agnostic.
 */
import {
  playerPlaylistIdbClear,
  playerPlaylistIdbDelete,
  playerPlaylistIdbGet,
  playerPlaylistIdbPut
} from "./playerPlaylistIdb.js";

function nextPlaylistId() {
  return `pl-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function fileNameFromUrl(url = "") {
  try {
    const base = new URL(url, "http://localhost").pathname.split("/").pop() || "";
    return decodeURIComponent(base) || url;
  } catch {
    const parts = String(url || "").split(/[/\\]/);
    return parts[parts.length - 1] || String(url || "");
  }
}

/** Only the serialisable shape goes to localStorage; File blobs live in IndexedDB keyed by id. */
function toManifestEntry(entry) {
  if (!entry) {
    return null;
  }
  if (entry.kind === "url") {
    return { id: entry.id, kind: "url", url: entry.url, label: entry.label };
  }
  if (entry.kind === "file") {
    return {
      id: entry.id,
      kind: "file",
      label: entry.label,
      fileName: entry.file?.name || entry.label,
      fileSize: entry.file?.size,
      fileLastModified: entry.file?.lastModified
    };
  }
  return null;
}

/**
 * @param {object} [options]
 * @param {string} [options.storagePrefix] localStorage namespace. Defaults to a namespace distinct
 *   from the original tools/scene-host player's (`threejson.scenePlayer.*`) so an app embedding this
 *   store cannot corrupt that app's saved playlist if both run on the same origin. Pass the original
 *   prefix explicitly only if you intend to share state with it.
 * @param {(url: string) => string} [options.resolveUrl] hook to rewrite relative scene URLs
 *   (e.g. @threejson/host-kit's resolveSceneHostUrl).
 */
export function createPlaylistStore({
  storagePrefix = "threejson.playerKit.playlist",
  resolveUrl = (url) => url
} = {}) {
  const MANIFEST_KEY = `${storagePrefix}.manifest`;
  const CURRENT_ID_KEY = `${storagePrefix}.currentId`;

  /** @type {{id:string, kind:"url"|"file", label:string, url?:string, file?:File}[]} */
  let entries = [];
  let currentIndex = -1;
  const listeners = new Set();
  // useSyncExternalStore requires a stable snapshot reference between notifications, so the
  // snapshot object is rebuilt only when something actually changes.
  let snapshot = { entries, currentIndex, current: null };

  function rebuildSnapshot() {
    snapshot = {
      entries,
      currentIndex,
      current: currentIndex >= 0 ? entries[currentIndex] ?? null : null
    };
  }

  function notify() {
    rebuildSnapshot();
    for (const listener of listeners) {
      listener();
    }
  }

  function persist() {
    try {
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(entries.map(toManifestEntry).filter(Boolean)));
      const current = entries[currentIndex];
      if (current?.id) {
        localStorage.setItem(CURRENT_ID_KEY, current.id);
      } else {
        localStorage.removeItem(CURRENT_ID_KEY);
      }
    } catch (error) {
      console.warn("[player-kit playlist] persist failed:", error);
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },

    getEntries: () => entries,
    getCurrentIndex: () => currentIndex,
    getCurrent: () => (currentIndex >= 0 ? entries[currentIndex] ?? null : null),

    addUrl(url, label = "") {
      entries = [
        ...entries,
        { id: nextPlaylistId(), kind: "url", url: resolveUrl(url), label: label || fileNameFromUrl(url) }
      ];
      notify();
      persist();
      return entries.length - 1;
    },

    async addFile(file) {
      const id = nextPlaylistId();
      await playerPlaylistIdbPut(id, file);
      entries = [...entries, { id, kind: "file", label: file.name, file }];
      notify();
      persist();
      return entries.length - 1;
    },

    /** Moves the pointer and returns the entry to load (or null when out of range). */
    activate(index) {
      if (index < 0 || index >= entries.length) {
        return null;
      }
      currentIndex = index;
      notify();
      persist();
      return entries[index];
    },

    /** @returns {{ removedCurrent: boolean, nextIndex: number }} so the app can decide whether to
     * load a replacement scene or stop playback. */
    async removeAt(index) {
      if (index < 0 || index >= entries.length) {
        return { removedCurrent: false, nextIndex: currentIndex };
      }
      const entry = entries[index];
      const removedCurrent = index === currentIndex;
      entries = entries.filter((_, i) => i !== index);
      if (entry.kind === "file" && entry.id) {
        await playerPlaylistIdbDelete(entry.id).catch((error) =>
          console.warn("[player-kit playlist] idb delete failed:", error)
        );
      }
      if (!entries.length) {
        currentIndex = -1;
      } else if (currentIndex > index) {
        currentIndex -= 1;
      } else if (removedCurrent) {
        currentIndex = Math.min(index, entries.length - 1);
      }
      notify();
      persist();
      return { removedCurrent, nextIndex: currentIndex };
    },

    async clear({ clearFiles = true } = {}) {
      entries = [];
      currentIndex = -1;
      notify();
      try {
        localStorage.removeItem(MANIFEST_KEY);
        localStorage.removeItem(CURRENT_ID_KEY);
      } catch {
        /* ignore */
      }
      if (clearFiles) {
        await playerPlaylistIdbClear().catch((error) =>
          console.warn("[player-kit playlist] idb clear failed:", error)
        );
      }
    },

    /**
     * Rehydrates from localStorage + IndexedDB. File entries whose blob is missing (cleared storage,
     * different profile) are dropped rather than left as broken rows.
     * @returns {Promise<{ restored: boolean, index: number }>}
     */
    async restore() {
      let manifest;
      try {
        const raw = localStorage.getItem(MANIFEST_KEY);
        manifest = raw ? JSON.parse(raw) : null;
      } catch {
        manifest = null;
      }
      if (!Array.isArray(manifest) || !manifest.length) {
        return { restored: false, index: -1 };
      }

      const restoredEntries = [];
      for (const item of manifest) {
        if (!item || typeof item !== "object" || !item.id) {
          continue;
        }
        if (item.kind === "url" && item.url) {
          restoredEntries.push({
            id: item.id,
            kind: "url",
            url: resolveUrl(item.url),
            label: item.label || fileNameFromUrl(item.url)
          });
        } else if (item.kind === "file") {
          const blob = await playerPlaylistIdbGet(item.id).catch(() => null);
          if (!blob) {
            continue;
          }
          const fileName = item.fileName || item.label || "scene.json";
          const file =
            blob instanceof File
              ? blob
              : new File([blob], fileName, {
                  type: blob.type || "application/json",
                  lastModified: item.fileLastModified || Date.now()
                });
          restoredEntries.push({ id: item.id, kind: "file", label: item.label || fileName, file });
        }
      }

      if (!restoredEntries.length) {
        return { restored: false, index: -1 };
      }
      entries = restoredEntries;
      const savedId = (() => {
        try {
          return localStorage.getItem(CURRENT_ID_KEY);
        } catch {
          return null;
        }
      })();
      const found = savedId ? entries.findIndex((e) => e.id === savedId) : 0;
      currentIndex = found >= 0 ? found : 0;
      notify();
      return { restored: true, index: currentIndex };
    }
  };
}
