/**
 * Viewport navigation gizmo — the corner widget whose faces/axes snap the camera to that view.
 *
 * This is the feature that replaced the old per-axis "three views" cycling: instead of a button that
 * steps through top/front/side, the gizmo is always on and clickable. The drawing logic is
 * host-kit's `viewportGizmoOverlay` (a thin wrapper over `three-viewport-gizmo`); this hook is the
 * React glue that (re)creates it against the live runtime and drives its per-frame render.
 *
 * Per-frame rendering: the gizmo shares the scene's WebGL renderer, so it must draw *after* the main
 * scene each frame or the scene's frame-start clear wipes it. `tools/scene-host` gets that ordering
 * from the engine's `afterRender` scene-option — but that hook does not reach player-kit's internal
 * render loop, so this drives the gizmo from its own requestAnimationFrame instead. That is exactly
 * how `three-viewport-gizmo`'s own examples render it (a shared animate loop calling gizmo.render()
 * after renderer.render()). Because this rAF is registered after the engine's loop is already
 * running, its callback runs after the engine's render within each frame, so the gizmo composites on
 * top rather than being cleared. `renderViewportGizmoOverlay` also saves/restores all renderer state
 * around its draw, so sharing the renderer never leaks scissor/viewport into the scene frame.
 *
 * App code, not a package: it is inherently bound to this app's DOM container and player instance.
 */
import { useEffect } from "react";
import {
  createViewportGizmoOverlay,
  renderViewportGizmoOverlay,
  updateViewportGizmoOverlay,
  disposeViewportGizmoOverlay
} from "@threejson/host-kit/js/viewportGizmoOverlay.js";

/**
 * @param {object} params
 * @param {object} params.player useScenePlayer result.
 * @param {React.RefObject<HTMLElement>} params.containerRef positioned element the gizmo overlays
 *   (must be position:relative; typically the viewport wrapper).
 * @param {number} [params.sceneVersion] bump to rebuild after a scene reload (fresh camera/renderer).
 * @param {boolean} [params.enabled=true]
 */
export function useViewportGizmo({ player, containerRef, sceneVersion = 0, enabled = true }) {
  const snapshot = player.getSnapshot?.();
  const camera = snapshot?.camera ?? null;
  const renderer = snapshot?.renderer ?? null;
  const controls = snapshot?.controls ?? null;

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !camera || !renderer || !container) {
      return undefined;
    }

    let rafId = 0;
    let disposed = false;
    try {
      createViewportGizmoOverlay({ camera, renderer, controls }, container);
      updateViewportGizmoOverlay();
    } catch (err) {
      // The gizmo is an enhancement, not core editing — never take the whole editor down with it.
      console.error("[useViewportGizmo] overlay setup failed:", err);
      disposeViewportGizmoOverlay();
      return undefined;
    }

    const tick = () => {
      if (disposed) {
        return;
      }
      renderViewportGizmoOverlay();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const onResize = () => updateViewportGizmoOverlay();
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      disposeViewportGizmoOverlay();
    };
    // camera/renderer identity changes on reload; sceneVersion forces a rebuild even if the engine
    // happens to reuse an object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, camera, renderer, controls, sceneVersion]);
}
