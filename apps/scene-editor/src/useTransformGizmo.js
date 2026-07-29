/**
 * TransformControls gizmo, wired to the same edit pipeline the inspector uses.
 *
 * The gizmo is the one editor surface that mutates a live Object3D *directly* (three drags the
 * object's own position/rotation/scale), so the job here is to fold that raw mutation back into the
 * command/history pipeline rather than let it bypass it:
 *
 *  - on drag start: disable orbit controls (so a drag doesn't also spin the camera) and
 *    `beginHistoryStep()` — snapshot the document so the whole drag is one undo;
 *  - on drag end: `syncBoxModelTransformFromObject3D` writes the live transform back into the
 *    object's descriptor (the scene exporter reads the descriptor, not the live matrix — without
 *    this the drag would vanish on the next reload), then `commitRuntimeToDocument()` makes it
 *    authoritative, and `onCommit` refreshes the tree + inspector.
 *
 * That mirrors the inspector's beginHistoryStep → mutate → commit bracket, so a gizmo drag and a
 * typed `object.patch` produce the same document and the same undo entry.
 *
 * Kept as app code: TransformControls is inherently DOM/canvas-bound and this is the only app with a
 * viewport it can attach to, so there is no second consumer to extract for.
 */
import { useEffect, useRef } from "react";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { syncBoxModelTransformFromObject3D } from "threejson";

/**
 * @param {object} params
 * @param {object} params.player useScenePlayer result (its getSnapshot exposes scene/camera/
 *   renderer/controls).
 * @param {any} params.object the live Object3D to manipulate, or null to detach.
 * @param {"translate"|"rotate"|"scale"} params.mode
 * @param {boolean} params.enabled
 * @param {() => void} params.onDragStart snapshot hook (beginHistoryStep).
 * @param {() => void | Promise<void>} params.onCommit fold-back hook (sync + commit + refresh).
 * @returns {{ helper: any | null }} the gizmo helper Object3D, so the caller can hide it from the
 *   scene tree via SceneTreePanel's extraRuntimeObjects.
 */
export function useTransformGizmo({ player, object, mode, enabled, onDragStart, onCommit }) {
  const controlRef = useRef(null);
  const helperRef = useRef(null);
  // Callbacks through a latest-ref so re-renders (new inline handlers every time) do not tear down
  // and rebuild the gizmo, which would drop an in-progress drag.
  const handlersRef = useRef({ onDragStart, onCommit });
  handlersRef.current = { onDragStart, onCommit };

  // Build the control once a renderer/camera exist. Rebuilding is keyed only on the renderer's DOM
  // element and the camera identity — both stable for a runtime's lifetime.
  const snapshot = player.getSnapshot?.();
  const renderer = snapshot?.renderer ?? null;
  const camera = snapshot?.camera ?? null;
  const scene = snapshot?.scene ?? null;
  const controls = snapshot?.controls ?? null;

  useEffect(() => {
    if (!renderer?.domElement || !camera || !scene) {
      return undefined;
    }
    const control = new TransformControls(camera, renderer.domElement);
    // Modern three: the control is not itself a scene object; its visual helper is.
    const helper = control.getHelper();
    scene.add(helper);
    controlRef.current = control;
    helperRef.current = helper;

    const onDragging = (event) => {
      // Freeze the camera for the duration of the drag.
      if (controls) {
        controls.enabled = !event.value;
      }
      if (event.value) {
        handlersRef.current.onDragStart?.();
      }
    };
    const onMouseUp = () => {
      const target = control.object;
      if (!target) {
        return;
      }
      // Live matrix → descriptor, then let the app commit + refresh.
      syncBoxModelTransformFromObject3D(target);
      void handlersRef.current.onCommit?.();
    };

    control.addEventListener("dragging-changed", onDragging);
    control.addEventListener("mouseUp", onMouseUp);

    return () => {
      control.removeEventListener("dragging-changed", onDragging);
      control.removeEventListener("mouseUp", onMouseUp);
      control.detach();
      scene.remove(helper);
      // Re-enable orbit in case teardown happened mid-drag.
      if (controls) {
        controls.enabled = true;
      }
      control.dispose();
      controlRef.current = null;
      helperRef.current = null;
    };
  }, [renderer, camera, scene, controls]);

  // Attach / detach as selection changes.
  useEffect(() => {
    const control = controlRef.current;
    if (!control) {
      return;
    }
    if (object && enabled) {
      control.attach(object);
    } else {
      control.detach();
    }
  }, [object, enabled]);

  // Mode toggle (translate / rotate / scale).
  useEffect(() => {
    controlRef.current?.setMode?.(mode);
  }, [mode]);

  return { helper: helperRef.current };
}
