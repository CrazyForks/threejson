/**
 * Ported from tools/scene-host/editor/js/editorViewPreserve.js — no @threejson/* package exposes
 * this. Preserves the camera pose across a scene reload for the *same* scene id (sessionStorage,
 * so it does not survive a tab close, matching the original), instead of the jarring re-fit that
 * would otherwise happen on every undo/redo (each is a full scene reload — see useEditorApi.js).
 *
 * The original's Code-mode camera-lock checkbox (#codeEditorCameraLockCheckbox) doesn't exist yet
 * (phase 8); until then this always preserves, matching the original's own fallback default when
 * that checkbox is absent (`sceneJson.cameraLockDefault !== false`, i.e. on by default).
 */
import { useCallback, useEffect, useRef } from "react";

function sceneKeyFor(payload, label) {
  const fromLabel = String(label || "").trim();
  if (fromLabel) {
    return fromLabel;
  }
  const docId = payload?.threeJsonId ?? payload?.name;
  return docId != null && String(docId).trim() ? String(docId).trim() : "untitled";
}

function sessionKey(sceneId) {
  return `editorView:${sceneId}`;
}

export function useViewPreserve(player, editor, sceneLabel) {
  const captureTimerRef = useRef(null);
  const boundControlsRef = useRef(null);
  const firstSyncRef = useRef(true);

  const getSceneId = useCallback(() => sceneKeyFor(editor.payload, sceneLabel), [editor.payload, sceneLabel]);

  const capture = useCallback(() => {
    const snap = player.getSnapshot?.();
    const camera = snap?.camera;
    const controls = snap?.controls;
    if (!camera || !controls) {
      return;
    }
    const p = camera.position;
    const t = controls.target;
    try {
      sessionStorage.setItem(
        sessionKey(getSceneId()),
        JSON.stringify({ position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z } })
      );
    } catch {
      /* ignore */
    }
  }, [player, getSceneId]);

  const scheduleCapture = useCallback(() => {
    if (captureTimerRef.current) {
      window.clearTimeout(captureTimerRef.current);
    }
    captureTimerRef.current = window.setTimeout(() => {
      captureTimerRef.current = null;
      capture();
    }, 200);
  }, [capture]);

  const restore = useCallback(() => {
    const snap = player.getSnapshot?.();
    const camera = snap?.camera;
    const controls = snap?.controls;
    if (!camera || !controls) {
      return false;
    }
    let parsed = null;
    try {
      const raw = sessionStorage.getItem(sessionKey(getSceneId()));
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    if (!parsed?.position || !parsed?.target) {
      return false;
    }
    camera.position.set(parsed.position.x, parsed.position.y, parsed.position.z);
    controls.target.set(parsed.target.x, parsed.target.y, parsed.target.z);
    controls.update();
    return true;
  }, [player, getSceneId]);

  // Bind capture listeners to whichever OrbitControls instance is currently live.
  useEffect(() => {
    const controls = player.getSnapshot?.()?.controls;
    if (!controls || boundControlsRef.current === controls) {
      return undefined;
    }
    boundControlsRef.current = controls;
    controls.addEventListener("change", scheduleCapture);
    controls.addEventListener("end", scheduleCapture);
    return () => {
      controls.removeEventListener("change", scheduleCapture);
      controls.removeEventListener("end", scheduleCapture);
    };
  }, [player, editor.sceneVersion, scheduleCapture]);

  // After each load (including the very first), try to restore this scene id's saved pose; the
  // player-kit runtime already fit-views on load, so this only overrides that when there is
  // something to restore — first-ever visit to a scene id silently falls through to the fit-view.
  useEffect(() => {
    if (!editor.sceneVersion) {
      return;
    }
    restore();
    firstSyncRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.sceneVersion]);
}
