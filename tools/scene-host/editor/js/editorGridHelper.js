import * as THREE from "three";
import { trackDisposableResource, buildAdaptiveContentBoundingBoxTHREE } from "threejson";

/** Fixed grid cell size in scene units; only the cell count scales with content extent. */
const CELL_SIZE = 5;
const MIN_DIVISIONS = 20;

function computeHelperExtent(scene) {
  const box = buildAdaptiveContentBoundingBoxTHREE(scene);
  let divisions = MIN_DIVISIONS;
  if (box && !box.isEmpty()) {
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (Number.isFinite(maxDim) && maxDim > 0) {
      const needed = Math.ceil((maxDim * 1.6) / CELL_SIZE / 2) * 2;
      divisions = Math.max(MIN_DIVISIONS, needed);
    }
  }
  return { size: divisions * CELL_SIZE, divisions };
}

/**
 * Precedence per scene load: a scene JSON-authored helper (mounted by the core deploy
 * pipeline from sceneConfig.helpers, tagged userData.objJson.objType) always wins over
 * the editor's Settings-driven default. Only when the scene has none does this module
 * inject its own runtime-only fallback, gated by editing.showGridHelper/showAxesHelper.
 * The bottom-status-bar toggle then flips whichever node is active for the current
 * scene load, purely in memory — it never touches settings or the scene JSON.
 */
export function createEditorGridHelper(host) {
  let fallbackGrid = null;
  let fallbackAxes = null;
  let activeGridNode = null;
  let activeAxesNode = null;

  function disposeHelperNode(node) {
    if (!node) {
      return null;
    }
    try {
      node.parent?.remove(node);
      node.geometry?.dispose?.();
      const mats = node.material;
      if (Array.isArray(mats)) {
        for (const mat of mats) {
          mat?.dispose?.();
        }
      } else {
        mats?.dispose?.();
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function disposeFallbackHelpers() {
    fallbackGrid = disposeHelperNode(fallbackGrid);
    fallbackAxes = disposeHelperNode(fallbackAxes);
  }

  function findJsonAuthoredHelper(scene, objType) {
    let found = null;
    scene.traverse((obj) => {
      if (found) {
        return;
      }
      if (obj.userData?.objJson?.objType === objType) {
        found = obj;
      }
    });
    return found;
  }

  function ensureFallbackNode(kind, scene) {
    if (kind === "axes") {
      if (!fallbackAxes) {
        const { size } = computeHelperExtent(scene);
        fallbackAxes = new THREE.AxesHelper(Math.max(size / 3, CELL_SIZE * 4));
        fallbackAxes.userData = { ...(fallbackAxes.userData || {}), type: "editorAxesHelper", editorOnly: true };
        fallbackAxes.name = "__editor_axes_helper__";
        trackDisposableResource(fallbackAxes);
      }
      if (fallbackAxes.parent !== scene) {
        scene.add(fallbackAxes);
      }
      return fallbackAxes;
    }
    if (!fallbackGrid) {
      const { size, divisions } = computeHelperExtent(scene);
      fallbackGrid = new THREE.GridHelper(size, divisions, 0x444444, 0x888888);
      fallbackGrid.userData = { ...(fallbackGrid.userData || {}), type: "editorGridHelper", editorOnly: true };
      fallbackGrid.name = "__editor_grid_helper__";
      trackDisposableResource(fallbackGrid);
    }
    if (fallbackGrid.parent !== scene) {
      scene.add(fallbackGrid);
    }
    return fallbackGrid;
  }

  /** Re-derives the active grid/axes node for the current scene. Call after scene load and after settings change. */
  function syncEditorGridHelperFromSettings() {
    const settings = host.getEditorSettings()?.editing;
    const wantGridDefault = Boolean(settings?.showGridHelper);
    const wantAxesDefault = Boolean(settings?.showAxesHelper);
    const scene = host.getScene();
    if (!scene?.isScene) {
      disposeFallbackHelpers();
      activeGridNode = null;
      activeAxesNode = null;
      return;
    }

    const jsonGrid = findJsonAuthoredHelper(scene, "gridHelper");
    if (jsonGrid) {
      disposeHelperNode(fallbackGrid);
      fallbackGrid = null;
      activeGridNode = jsonGrid;
    } else if (wantGridDefault) {
      activeGridNode = ensureFallbackNode("grid", scene);
      activeGridNode.visible = true;
    } else {
      disposeHelperNode(fallbackGrid);
      fallbackGrid = null;
      activeGridNode = null;
    }

    const jsonAxes = findJsonAuthoredHelper(scene, "axesHelper");
    if (jsonAxes) {
      disposeHelperNode(fallbackAxes);
      fallbackAxes = null;
      activeAxesNode = jsonAxes;
    } else if (wantAxesDefault) {
      activeAxesNode = ensureFallbackNode("axes", scene);
      activeAxesNode.visible = true;
    } else {
      disposeHelperNode(fallbackAxes);
      fallbackAxes = null;
      activeAxesNode = null;
    }
  }

  /**
   * Ephemeral, runtime-only visibility flip for the currently active node (JSON-authored
   * or settings-driven fallback). If neither settings nor the scene JSON currently show a
   * helper, this creates the fallback on demand so the user can still force one on. Never
   * persists to settings storage or the scene JSON.
   */
  function toggleRuntimeHelperVisible(kind) {
    const scene = host.getScene();
    if (!scene?.isScene) {
      return null;
    }
    let node = kind === "axes" ? activeAxesNode : activeGridNode;
    if (node) {
      node.visible = !node.visible;
      return node.visible;
    }
    node = ensureFallbackNode(kind, scene);
    node.visible = true;
    if (kind === "axes") {
      activeAxesNode = node;
    } else {
      activeGridNode = node;
    }
    return true;
  }

  function isHelperVisible(kind) {
    const node = kind === "axes" ? activeAxesNode : activeGridNode;
    return Boolean(node?.visible);
  }

  function dispose() {
    disposeFallbackHelpers();
    activeGridNode = null;
    activeAxesNode = null;
  }

  return {
    syncEditorGridHelperFromSettings,
    toggleRuntimeHelperVisible,
    isHelperVisible,
    dispose
  };
}
