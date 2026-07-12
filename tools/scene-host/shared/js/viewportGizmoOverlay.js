/**
 * Thin wrapper around the `three-viewport-gizmo` widget (click a face/axis to snap the camera
 * to that view). Shared by the editor and the shower so both draw/dispose it the same way.
 */
import { ViewportGizmo } from "three-viewport-gizmo";

let gizmo = null;

export function disposeViewportGizmoOverlay() {
  gizmo?.dispose?.();
  gizmo = null;
}

/**
 * (Re)creates the gizmo for the given runtime. Disposes any previous instance first, since the
 * camera/renderer/controls are typically fresh objects after a scene (re)load.
 * @param {{ camera?: object, renderer?: object, controls?: object }} runtime
 * @param {HTMLElement} container Positioned (position:relative) element the gizmo overlays.
 * @param {object} [options] Passed through to `three-viewport-gizmo` (size, placement, etc).
 * @returns {object|null} the created gizmo instance, or null if camera/renderer/container are missing
 */
export function createViewportGizmoOverlay(runtime, container, options = {}) {
  disposeViewportGizmoOverlay();
  if (!runtime?.camera || !runtime?.renderer || !container) {
    return null;
  }
  gizmo = new ViewportGizmo(runtime.camera, runtime.renderer, {
    container,
    size: 90,
    placement: "top-right",
    ...options
  });
  if (runtime.controls) {
    gizmo.attachControls(runtime.controls);
  }
  return gizmo;
}

/** Call once per animation frame, after the main scene render, e.g. from an `afterRender` hook. */
export function renderViewportGizmoOverlay() {
  if (!gizmo) {
    return;
  }
  // The main scene render may have left a non-default render target bound (e.g. an
  // EffectComposer's read/write buffer); the gizmo draws straight to the canvas via
  // renderer.render(), so it needs the default (screen) target restored first, or it silently
  // paints into the off-screen buffer instead of what actually reaches the display.
  gizmo.renderer?.setRenderTarget?.(null);
  gizmo.render();
}

export function getViewportGizmoOverlay() {
  return gizmo;
}
