/**
 * Pin/peek state for the four chrome regions (left dock, right dock, top bar, bottom bar), matching
 * tools/scene-host/editor's #rootContainer.{leftDockPinned,rightDockPinned,topBarPinned,bottomBarPinned}
 * class-driven CSS in editor-base.css. A pinned region stays visible; an unpinned one collapses to a
 * thin edge strip and only widens ("peek") while the pointer is over its hover zone.
 *
 * Persisted under the same key family the original's "清除设置缓存" menu action targets conceptually
 * (view-chrome visibility is a local UI preference, not scene data).
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "threejson.editor.viewChrome";
const DOCKS = ["leftDock", "rightDock", "topBar", "bottomBar"];

function loadPinned() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function useDockChrome() {
  const [pinned, setPinned] = useState(() => {
    const saved = loadPinned();
    return Object.fromEntries(DOCKS.map((d) => [d, saved[d] !== false]));
  });
  const [peek, setPeek] = useState(() => Object.fromEntries(DOCKS.map((d) => [d, false])));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pinned));
  }, [pinned]);

  const togglePinned = useCallback((dock) => {
    setPinned((prev) => ({ ...prev, [dock]: !prev[dock] }));
  }, []);

  const setPinnedValue = useCallback((dock, value) => {
    setPinned((prev) => ({ ...prev, [dock]: value }));
  }, []);

  const setDockPeek = useCallback((dock, value) => {
    setPeek((prev) => (prev[dock] === value ? prev : { ...prev, [dock]: value }));
  }, []);

  const clearCache = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setPinned(Object.fromEntries(DOCKS.map((d) => [d, true])));
  }, []);

  const rootClassName = [
    "app",
    pinned.leftDock ? "leftDockPinned" : peek.leftDock ? "leftDockPeek" : "",
    pinned.rightDock ? "rightDockPinned" : peek.rightDock ? "rightDockPeek" : "",
    pinned.topBar ? "topBarPinned" : peek.topBar ? "topBarPeek" : "",
    pinned.bottomBar ? "bottomBarPinned" : peek.bottomBar ? "bottomBarPeek" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return { pinned, togglePinned, setPinnedValue, peek, setDockPeek, clearCache, rootClassName };
}
