/**
 * Ported from tools/scene-host/editor/js/uiFeedback.js — no @threejson/* package exposes this (it
 * is DOM-coupled editor-shell UI, same pattern as ThreeBox's own uiFeedback port). Drives the
 * #messageBox toast directly by DOM id, same as the original, rather than through React state —
 * a toast is fire-and-forget UI that many unrelated call sites need to reach without re-rendering
 * their owner, which is exactly what the original's plain-function API is for.
 *
 * The loading mask itself is still driven by @threejson/react's player state (see App.jsx); only
 * the toast (showMessage) is wired up this phase. Duration reads live from the settings store
 * (general.messageToastDurationMs) added in phase 3.
 */
import { useCallback, useRef } from "react";
import { getEditorSettings } from "./useEditorSettings.js";

const COLOR_BY_TYPE = {
  info: "rgba(20, 20, 20, 0.82)",
  success: "rgba(46, 125, 50, 0.88)",
  warning: "rgba(176, 118, 0, 0.9)",
  error: "rgba(180, 35, 24, 0.9)"
};

export function useUiFeedback() {
  const timerRef = useRef(null);

  const showMessage = useCallback((text, type = "info") => {
    const el = document.getElementById("messageBox");
    if (!el) {
      return;
    }
    el.textContent = String(text || "");
    el.style.background = COLOR_BY_TYPE[type] || COLOR_BY_TYPE.info;
    el.style.display = "block";
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    const duration = getEditorSettings().general.messageToastDurationMs;
    timerRef.current = window.setTimeout(() => {
      el.style.display = "none";
    }, duration);
  }, []);

  return { showMessage };
}
