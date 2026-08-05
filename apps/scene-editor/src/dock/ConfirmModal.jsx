/**
 * Ported from tools/scene-host/editor/js/editorConfirmModal.js — generic yes/no dialog styled like
 * the editor's other custom modals (.tjzExportDialog), so every "are you sure?" looks consistent
 * instead of a native window.confirm() popup. React state replaces the original's DOM-id lookups
 * and manual show/hide; the interaction contract (Escape/backdrop = cancel, Enter = confirm, focus
 * moves to the confirm button on open) is unchanged.
 */
import { useEffect, useRef } from "react";

export function ConfirmModal({ state, onCancel, onConfirm }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (state) {
      requestAnimationFrame(() => confirmRef.current?.focus({ preventScroll: true }));
    }
  }, [state]);

  useEffect(() => {
    if (!state) {
      return undefined;
    }
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [state, onCancel, onConfirm]);

  if (!state) {
    return null;
  }
  return (
    <div
      id="editorConfirmModal"
      className="visible"
      role="dialog"
      aria-modal="true"
      aria-label="确认"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="tjzExportDialog" onClick={(e) => e.stopPropagation()}>
        <div className="tjzExportHeader">{state.title || "确认"}</div>
        <div className="tjzExportBody">
          <div className="editorConfirmMessage">{state.message}</div>
        </div>
        <div className="tjzExportFooter">
          <button className="miniBtn" type="button" onClick={onCancel}>
            {state.cancelLabel || "取消"}
          </button>
          <button className="miniBtn" type="button" ref={confirmRef} onClick={onConfirm}>
            {state.confirmLabel || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
