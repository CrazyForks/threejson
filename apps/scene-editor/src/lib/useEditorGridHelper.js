/**
 * Ported from tools/scene-host/editor/js/editorGridHelper.js — no @threejson/* package exposes
 * this (it is editor-only UI, not engine behavior). Adapted from the original's `host` getter
 * object to a React hook operating on the live player snapshot; the helper-creation/dispose logic
 * and the "JSON-authored helper wins over the runtime fallback" precedence are unchanged.
 *
 * The initial on/off state seeds from the settings store's editing.showGridHelper/showAxesHelper
 * (added in phase 3); the runtime toggle only ever affects the current session, never settings.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { trackDisposableResource, buildAdaptiveContentBoundingBoxTHREE } from "threejson";
import { getEditorSettings } from "./useEditorSettings.js";

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

/** @param {() => THREE.Scene | null} getScene */
export function useEditorGridHelper(getScene, sceneVersion) {
  const fallbackGridRef = useRef(null);
  const fallbackAxesRef = useRef(null);
  const activeGridRef = useRef(null);
  const activeAxesRef = useRef(null);
  const [gridVisible, setGridVisible] = useState(() => Boolean(getEditorSettings().editing.showGridHelper));
  const [axesVisible, setAxesVisible] = useState(() => Boolean(getEditorSettings().editing.showAxesHelper));

  const ensureFallbackNode = useCallback((kind, scene) => {
    if (kind === "axes") {
      if (!fallbackAxesRef.current) {
        const { size } = computeHelperExtent(scene);
        const axes = new THREE.AxesHelper(Math.max(size / 3, CELL_SIZE * 4));
        axes.userData = { ...(axes.userData || {}), type: "editorAxesHelper", editorOnly: true };
        axes.name = "__editor_axes_helper__";
        trackDisposableResource(axes);
        fallbackAxesRef.current = axes;
      }
      if (fallbackAxesRef.current.parent !== scene) {
        scene.add(fallbackAxesRef.current);
      }
      return fallbackAxesRef.current;
    }
    if (!fallbackGridRef.current) {
      const { size, divisions } = computeHelperExtent(scene);
      const grid = new THREE.GridHelper(size, divisions, 0x444444, 0x888888);
      grid.userData = { ...(grid.userData || {}), type: "editorGridHelper", editorOnly: true };
      grid.name = "__editor_grid_helper__";
      trackDisposableResource(grid);
      fallbackGridRef.current = grid;
    }
    if (fallbackGridRef.current.parent !== scene) {
      scene.add(fallbackGridRef.current);
    }
    return fallbackGridRef.current;
  }, []);

  const sync = useCallback(() => {
    const scene = getScene();
    if (!scene?.isScene) {
      fallbackGridRef.current = disposeHelperNode(fallbackGridRef.current);
      fallbackAxesRef.current = disposeHelperNode(fallbackAxesRef.current);
      activeGridRef.current = null;
      activeAxesRef.current = null;
      return;
    }

    const jsonGrid = findJsonAuthoredHelper(scene, "gridHelper");
    if (jsonGrid) {
      fallbackGridRef.current = disposeHelperNode(fallbackGridRef.current);
      activeGridRef.current = jsonGrid;
    } else if (gridVisible) {
      activeGridRef.current = ensureFallbackNode("grid", scene);
      activeGridRef.current.visible = true;
    } else {
      fallbackGridRef.current = disposeHelperNode(fallbackGridRef.current);
      activeGridRef.current = null;
    }

    const jsonAxes = findJsonAuthoredHelper(scene, "axesHelper");
    if (jsonAxes) {
      fallbackAxesRef.current = disposeHelperNode(fallbackAxesRef.current);
      activeAxesRef.current = jsonAxes;
    } else if (axesVisible) {
      activeAxesRef.current = ensureFallbackNode("axes", scene);
      activeAxesRef.current.visible = true;
    } else {
      fallbackAxesRef.current = disposeHelperNode(fallbackAxesRef.current);
      activeAxesRef.current = null;
    }
  }, [getScene, gridVisible, axesVisible, ensureFallbackNode]);

  // Re-sync on every scene (re)load and whenever the runtime toggle flips.
  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneVersion, gridVisible, axesVisible]);

  useEffect(
    () => () => {
      fallbackGridRef.current = disposeHelperNode(fallbackGridRef.current);
      fallbackAxesRef.current = disposeHelperNode(fallbackAxesRef.current);
    },
    []
  );

  return {
    gridVisible,
    axesVisible,
    toggleGrid: () => setGridVisible((v) => !v),
    toggleAxes: () => setAxesVisible((v) => !v)
  };
}
