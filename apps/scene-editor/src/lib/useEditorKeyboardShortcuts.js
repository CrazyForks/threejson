/**
 * Ported from tools/scene-host/editor/js/editorKeyboardShortcuts.js — no @threejson/* package
 * exposes this. Only Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Y or +Shift+Z (redo) are wired this phase —
 * the original's Alt+F5 (run scene preview) and Ctrl+S (save) target features that don't exist yet
 * (phases 5 and 6), so binding them now would fire into nothing. Skips when a text field is
 * focused, matching the original's CodeMirror-focus guard (there is no CodeMirror yet either).
 */
import { useEffect } from "react";

function isTypingTarget(el) {
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useEditorKeyboardShortcuts({ onUndo, onRedo }) {
  useEffect(() => {
    function onKeyDown(event) {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey || isTypingTarget(document.activeElement)) {
        return;
      }
      const key = String(event.key || "").toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        onUndo();
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        onRedo();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onUndo, onRedo]);
}
