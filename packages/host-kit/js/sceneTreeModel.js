/**
 * Headless scene-tree model: turns a live THREE.Object3D graph into a plain, serialisable tree that
 * a UI can render, plus the lookups a tree panel needs.
 *
 * Deliberately framework-agnostic and render-free. The editor and the shower want visibly different
 * panels (an editable hierarchy vs. a read-only outline), but both need the same two non-obvious
 * things, which is what actually lives here:
 *
 *  - **Which objects to hide.** A loaded scene's graph contains far more than the author's content:
 *    transform gizmos, box-edge highlights, grid/axes helpers, and the engine's internal native
 *    scene wrapper. Showing those in an outliner is a bug, and the exclusion rules are fiddly enough
 *    that each app would otherwise reimplement a different subset of them.
 *  - **How to find an object again.** Tree rows must survive a re-render and a scene reload, so they
 *    key off `threeJsonId` (stable, authored) with `uuid` as the per-session fallback.
 *
 * The engine-side identity rule: an object's ThreeJSON id lives at `userData.objJson.threeJsonId`.
 */

/** Object types that three.js itself creates for visual aids, never authored content. */
const HELPER_TYPES = new Set(["AxesHelper", "GridHelper", "BoxHelper", "TransformControls"]);

/** `objType` values that are engine/editor scaffolding rather than scene objects. */
const RUNTIME_OBJ_TYPES = new Set(["gridHelper", "axesHelper", "boxHelper"]);

/** The engine wraps an imported native three.js scene in a node with this reserved name. */
const NATIVE_SCENE_NODE_NAME = "__threejson_native_scene__";

/**
 * @param {any} obj
 * @param {object} [options]
 * @param {any[]} [options.extraRuntimeObjects] app-owned gizmos to hide (the editor passes its
 *   TransformControls, its helper, and the box-edge helper — those are instances, not types).
 * @param {boolean} [options.hideLights=true] lights are scene *configuration* rather than tree
 *   content in the existing panels; pass false to list them.
 */
export function isRuntimeOnlyObject(obj, options = {}) {
  if (!obj) {
    return true;
  }
  const { extraRuntimeObjects, hideLights = true } = options;

  if (obj.userData?.editorOnly === true || obj.userData?.type === "editorGridHelper") {
    return true;
  }
  if (obj.userData?.type === "helperBoxEdge") {
    return true;
  }
  if (Array.isArray(extraRuntimeObjects) && extraRuntimeObjects.some((item) => item && item === obj)) {
    return true;
  }
  if (obj.isTransformControls || HELPER_TYPES.has(obj.type)) {
    return true;
  }
  const objType = obj.userData?.objJson?.objType;
  if (RUNTIME_OBJ_TYPES.has(objType)) {
    return true;
  }
  if (hideLights && objType === "light") {
    return true;
  }
  if (obj.name === NATIVE_SCENE_NODE_NAME) {
    return true;
  }
  return false;
}

/** The authored, stable id for an object — empty string when it has none. */
export function readThreeJsonId(obj) {
  return String(obj?.userData?.objJson?.threeJsonId || "").trim();
}

/**
 * Build the render-ready tree.
 *
 * @param {any} root a THREE.Scene / Object3D
 * @param {object} [options] forwarded to isRuntimeOnlyObject, plus:
 * @param {number} [options.maxDepth=Infinity] guard for pathological imported hierarchies.
 * @returns {Array<{uuid:string,threeJsonId:string,name:string,type:string,visible:boolean,
 *   children:Array,object:any}>} top-level nodes. `object` is the live Object3D — handy for
 *   selection/highlighting, and the reason this is a model rather than pure data.
 */
export function buildSceneTreeModel(root, options = {}) {
  const { maxDepth = Infinity } = options;
  if (!root?.children) {
    return [];
  }
  const walk = (nodes, depth) => {
    const out = [];
    for (const child of nodes) {
      if (isRuntimeOnlyObject(child, options)) {
        continue;
      }
      out.push({
        uuid: String(child.uuid || ""),
        threeJsonId: readThreeJsonId(child),
        // An unnamed node still needs a label; its type is the most useful thing to show.
        name: String(child.name || "").trim(),
        type: String(child.type || "Object3D"),
        visible: child.visible !== false,
        children: depth + 1 < maxDepth ? walk(child.children || [], depth + 1) : [],
        object: child
      });
    }
    return out;
  };
  return walk(root.children, 0);
}

/** Total nodes in a built model — the count a panel shows, excluding filtered runtime objects. */
export function countSceneTreeNodes(nodes) {
  let total = 0;
  for (const node of nodes || []) {
    total += 1 + countSceneTreeNodes(node.children);
  }
  return total;
}

/**
 * Resolve a tree row back to its live object after a re-render or a scene reload.
 * Prefers the authored id (survives reloads); falls back to uuid (session-local).
 */
export function findObjectInScene(root, { threeJsonId, uuid } = {}) {
  if (!root?.traverse) {
    return null;
  }
  const wantedId = String(threeJsonId || "").trim();
  const wantedUuid = String(uuid || "").trim();
  if (!wantedId && !wantedUuid) {
    return null;
  }
  let byId = null;
  let byUuid = null;
  root.traverse((obj) => {
    if (!byId && wantedId && readThreeJsonId(obj) === wantedId) {
      byId = obj;
    }
    if (!byUuid && wantedUuid && obj?.uuid === wantedUuid) {
      byUuid = obj;
    }
  });
  return byId || byUuid || null;
}

/** Flatten a model depth-first — for keyboard navigation and "select next/previous". */
export function flattenSceneTree(nodes, depth = 0) {
  const out = [];
  for (const node of nodes || []) {
    out.push({ ...node, depth });
    out.push(...flattenSceneTree(node.children, depth + 1));
  }
  return out;
}
