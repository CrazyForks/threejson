/**
 * Thin wrapper around the `three-viewport-gizmo` widget (click a face/axis to snap the camera
 * to that view). Shared by the editor and the shower so both draw/dispose it the same way.
 */
import { Vector4 } from "three";
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
  const renderer = gizmo.renderer;
  const viewport = renderer?.getViewport?.(new Vector4());
  const scissor = renderer?.getScissor?.(new Vector4());
  const scissorTest = renderer?.getScissorTest?.();
  const renderTarget = renderer?.getRenderTarget?.();
  const autoClear = renderer?.autoClear;
  // The main scene render may have left a non-default render target bound (e.g. an
  // EffectComposer's read/write buffer); the gizmo draws straight to the canvas via
  // renderer.render(), so it needs the default (screen) target restored first, or it silently
  // paints into the off-screen buffer instead of what actually reaches the display.
  renderer?.setRenderTarget?.(null);
  try {
    gizmo.render();
  } finally {
    // ViewportGizmo shares the scene renderer. Never let its small viewport/scissor
    // leak into the following main-scene frame, especially after Code/All resizing.
    renderer?.setRenderTarget?.(renderTarget ?? null);
    if (viewport) renderer?.setViewport?.(viewport);
    if (scissor) renderer?.setScissor?.(scissor);
    if (typeof scissorTest === "boolean") renderer?.setScissorTest?.(scissorTest);
    if (typeof autoClear === "boolean" && renderer) renderer.autoClear = autoClear;
  }
}

/** Recompute gizmo bounds after its renderer canvas or overlay container changes size. */
export function updateViewportGizmoOverlay() {
  gizmo?.update?.();
}

export function getViewportGizmoOverlay() {
  return gizmo;
}
