/** Capture the camera pose that a host mode switch must not mutate. */
export function captureEditorCameraView(camera, controls) {
  if (!camera) {
    return null;
  }
  return {
    position: camera.position?.clone?.(),
    quaternion: camera.quaternion?.clone?.(),
    up: camera.up?.clone?.(),
    zoom: Number(camera.zoom),
    target: controls?.target?.clone?.()
  };
}

/** Restore pose/target while intentionally retaining the new viewport aspect. */
export function restoreEditorCameraView(camera, controls, view) {
  if (!camera || !view) {
    return false;
  }
  if (view.position && camera.position?.copy) camera.position.copy(view.position);
  if (view.quaternion && camera.quaternion?.copy) camera.quaternion.copy(view.quaternion);
  if (view.up && camera.up?.copy) camera.up.copy(view.up);
  if (Number.isFinite(view.zoom)) camera.zoom = view.zoom;
  if (view.target && controls?.target?.copy) controls.target.copy(view.target);
  camera.updateProjectionMatrix?.();
  camera.updateMatrixWorld?.(true);
  controls?.update?.();
  return true;
}
