/**
 * Scene helpers: GridHelper / AxesHelper (sceneConfig.helpers).
 */
import * as THREE from "three";
import { resolvePosition, resolveRotation } from "../util/vectorValue.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject, unregisterObject } from "../handler/objectRegistry.js";
import { estimateSceneExtentFromPayload } from "../util/sceneRuntimeDefaults.js";

/** Grid cell size in scene units, kept fixed regardless of scene extent (only the count of cells changes). */
const DEFAULT_HELPER_CELL_SIZE = 5;
const DEFAULT_HELPER_MIN_DIVISIONS = 20;

const ASSIST_HELPER_OBJ_TYPES = new Set(["gridhelper", "axeshelper", "boxhelper"]);

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasValue(value) {
  return value !== undefined && value !== null;
}

function clonePlainObject(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_e) {
    return { ...value };
  }
}

function normalizePosition(position = {}) {
  return resolvePosition(position);
}

function normalizeRotation(rotation = {}) {
  return resolveRotation(rotation);
}

function applyHelperTransform(object3D, config = {}) {
  const position = normalizePosition(config.position);
  const rotation = normalizeRotation(config.rotation);
  object3D.position.set(position.x, position.y, position.z);
  object3D.rotation.set(rotation.x, rotation.y, rotation.z);
  object3D.visible = config.visible !== false;
}

/**
 * Merge helpers from sceneConfig / worldInfo (includes gridHelper / axesHelper sugar).
 * `helpers.grid` / `helpers.axes` take precedence over top-level aliases; sceneConfig over worldInfo.
 *
 * @param {object} [sceneConfig]
 * @param {object} [worldInfo]
 * @returns {{ grid?: object, axes?: object }|null}
 */
export function normalizeHelpersConfig(sceneConfig = {}, worldInfo = {}) {
  const sc = isPlainObject(sceneConfig) ? sceneConfig : {};
  const wi = isPlainObject(worldInfo) ? worldInfo : {};
  const scHelpers = isPlainObject(sc.helpers) ? sc.helpers : {};
  const wiHelpers = isPlainObject(wi.helpers) ? wi.helpers : {};

  /** @type {{ grid?: object, axes?: object }} */
  const out = {};

  if (hasOwn(scHelpers, "grid") && isPlainObject(scHelpers.grid)) {
    out.grid = clonePlainObject(scHelpers.grid);
  } else if (hasOwn(wiHelpers, "grid") && isPlainObject(wiHelpers.grid)) {
    out.grid = clonePlainObject(wiHelpers.grid);
  } else if (hasOwn(sc, "gridHelper") && isPlainObject(sc.gridHelper)) {
    out.grid = clonePlainObject(sc.gridHelper);
  } else if (hasOwn(wi, "gridHelper") && isPlainObject(wi.gridHelper)) {
    out.grid = clonePlainObject(wi.gridHelper);
  }

  if (hasOwn(scHelpers, "axes") && isPlainObject(scHelpers.axes)) {
    out.axes = clonePlainObject(scHelpers.axes);
  } else if (hasOwn(wiHelpers, "axes") && isPlainObject(wiHelpers.axes)) {
    out.axes = clonePlainObject(wiHelpers.axes);
  } else if (hasOwn(sc, "axesHelper") && isPlainObject(sc.axesHelper)) {
    out.axes = clonePlainObject(sc.axesHelper);
  } else if (hasOwn(wi, "axesHelper") && isPlainObject(wi.axesHelper)) {
    out.axes = clonePlainObject(wi.axesHelper);
  }

  if (!out.grid && !out.axes) {
    return null;
  }
  return out;
}

/**
 * Compute a grid/axes size that comfortably contains the scene's estimated extent, keeping the
 * grid's per-cell size fixed (DEFAULT_HELPER_CELL_SIZE) and only scaling the cell count.
 * @param {object} payload scene JSON payload (worldInfo / objectList), pre-normalize
 * @returns {{ size: number, divisions: number }}
 */
function computeDefaultHelperExtent(payload) {
  const extentGuess = estimateSceneExtentFromPayload(payload);
  const maxDim = extentGuess?.maxDim;
  let divisions = DEFAULT_HELPER_MIN_DIVISIONS;
  if (Number.isFinite(maxDim) && maxDim > 0) {
    const needed = Math.ceil((maxDim * 1.6) / DEFAULT_HELPER_CELL_SIZE / 2) * 2;
    divisions = Math.max(DEFAULT_HELPER_MIN_DIVISIONS, needed);
  }
  return { size: divisions * DEFAULT_HELPER_CELL_SIZE, divisions };
}

/**
 * Inject default grid/axes helpers into a scene payload when it doesn't already specify any
 * (via sceneConfig.helpers / worldInfo.helpers / the legacy gridHelper/axesHelper aliases).
 * Sizes the grid/axes to comfortably contain the scene's estimated extent, keeping the grid's
 * per-cell size fixed. Mutates and returns `payload`; a no-op when helpers are already present,
 * so an explicit user-authored helpers config always wins.
 * @param {object} payload
 * @returns {object} same payload reference
 */
export function ensureDefaultSceneHelpers(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  if (normalizeHelpersConfig(payload.sceneConfig, payload.worldInfo)) {
    return payload;
  }
  const { size, divisions } = computeDefaultHelperExtent(payload);
  payload.sceneConfig = isPlainObject(payload.sceneConfig) ? payload.sceneConfig : {};
  payload.sceneConfig.helpers = {
    grid: {
      visible: true,
      size,
      divisions,
      colorCenterLine: "#444444",
      colorGrid: "#888888"
    },
    axes: {
      visible: true,
      size: Math.max(size / 3, DEFAULT_HELPER_CELL_SIZE * 4)
    }
  };
  return payload;
}

/**
 * @param {object|null|undefined} helpersConfig
 * @returns {object|null}
 */
export function canonicalizeHelpersForSceneConfig(helpersConfig) {
  if (!helpersConfig || typeof helpersConfig !== "object") {
    return null;
  }
  const next = {};
  if (isPlainObject(helpersConfig.grid)) {
    next.grid = clonePlainObject(helpersConfig.grid);
  }
  if (isPlainObject(helpersConfig.axes)) {
    next.axes = clonePlainObject(helpersConfig.axes);
  }
  return Object.keys(next).length > 0 ? next : null;
}

/**
 * @param {object} config
 * @param {string} objType
 * @returns {THREE.GridHelper|THREE.AxesHelper|null}
 */
export function createSceneHelperFromConfig(config, objType) {
  if (!config || typeof config !== "object") {
    return null;
  }
  if (config.visible === false) {
    return null;
  }

  let helper = null;
  if (objType === "gridHelper") {
    const size = Number(hasValue(config.size) ? config.size : 10);
    const divisions = Math.max(1, Math.floor(Number(hasValue(config.divisions) ? config.divisions : 10)));
    const colorCenterLine = hasValue(config.colorCenterLine) ? config.colorCenterLine : 0x444444;
    const colorGrid = hasValue(config.colorGrid) ? config.colorGrid : 0x888888;
    helper = new THREE.GridHelper(size, divisions, colorCenterLine, colorGrid);
  } else if (objType === "axesHelper") {
    const size = Number(hasValue(config.size) ? config.size : 10);
    helper = new THREE.AxesHelper(size);
  } else {
    return null;
  }

  trackDisposableResource(helper);
  applyHelperTransform(helper, config);
  helper.userData = {
    ...(typeof helper.userData === "object" && helper.userData ? helper.userData : {}),
    objJson: {
      objType,
      ...clonePlainObject(config)
    }
  };
  return helper;
}

function isAssistHelperNode(child) {
  const objType = typeof child?.userData?.objJson?.objType === "string"
    ? child.userData.objJson.objType.trim().toLowerCase()
    : "";
  return ASSIST_HELPER_OBJ_TYPES.has(objType);
}

function disposeAssistHelperNode(child) {
  if (!child) {
    return;
  }
  unregisterObject(child, { recursive: true, keepDescriptor: false });
  if (child.geometry && typeof child.geometry.dispose === "function") {
    child.geometry.dispose();
  }
  if (child.material && typeof child.material.dispose === "function") {
    child.material.dispose();
  }
  if (child.parent) {
    child.parent.remove(child);
  }
}

/**
 * @param {import("three").Object3D} parent Usually Scene; only replaces/removes assist helper nodes
 * @param {{ grid?: object, axes?: object }|null|undefined} helpersConfig
 */
export function mountSceneHelpers(parent, helpersConfig) {
  if (!parent) {
    return;
  }
  if (typeof parent.traverse === "function") {
    const toRemove = [];
    parent.traverse((child) => {
      if (child !== parent && isAssistHelperNode(child)) {
        toRemove.push(child);
      }
    });
    for (let i = 0; i < toRemove.length; i++) {
      disposeAssistHelperNode(toRemove[i]);
    }
  }

  if (!helpersConfig || typeof helpersConfig !== "object") {
    return;
  }

  if (helpersConfig.grid) {
    const grid = createSceneHelperFromConfig(helpersConfig.grid, "gridHelper");
    if (grid) {
      parent.add(grid);
      registerObject(grid, grid.userData?.objJson, { recursive: false });
    }
  }
  if (helpersConfig.axes) {
    const axes = createSceneHelperFromConfig(helpersConfig.axes, "axesHelper");
    if (axes) {
      parent.add(axes);
      registerObject(axes, axes.userData?.objJson, { recursive: false });
    }
  }
}
