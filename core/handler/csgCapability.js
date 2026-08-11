/**
 * Lazy CSG capability facade.
 *
 * Scene loading is asynchronous, so it can opt into three-bvh-csg only when a
 * descriptor actually contains joins/intersections/holes. The compatibility
 * `threejson/csg` entry registers the same synchronous implementation eagerly.
 */

let implementation = null;
let implementationPromise = null;

export function registerCsgBrushOpsImplementation(next) {
  if (!next?.createBrushFromMesh || !next?.evaluateMeshBoolean) {
    throw new Error("registerCsgBrushOpsImplementation: invalid CSG implementation");
  }
  implementation = next;
  return implementation;
}

export function isCsgBrushOpsLoaded() {
  return implementation !== null;
}

export async function loadCsgBrushOps() {
  if (implementation) return implementation;
  if (!implementationPromise) {
    implementationPromise = import("./csgBrushOps.js")
      .then((module) => {
        if (!implementation) {
          registerCsgBrushOpsImplementation(module);
        }
        return implementation;
      })
      .catch((error) => {
        implementationPromise = null;
        throw error;
      });
  }
  return implementationPromise;
}

function requireImplementation() {
  if (!implementation) {
    throw new Error(
      "ThreeJSON CSG is not loaded. Use the async createJsonScene API, call loadCsgBrushOps(), " +
      "or import threejson/csg before synchronous CSG operations."
    );
  }
  return implementation;
}

export function createBrushFromMesh(mesh, options) {
  return requireImplementation().createBrushFromMesh(mesh, options);
}

export function evaluateMeshBoolean(masterMesh, slaveMesh, operation) {
  return requireImplementation().evaluateMeshBoolean(masterMesh, slaveMesh, operation);
}

export function scenePayloadNeedsCsg(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);

  for (const key of ["joins", "inters", "holes"]) {
    if (Array.isArray(value[key]) && value[key].length > 0) return true;
  }
  for (const child of Object.values(value)) {
    if (scenePayloadNeedsCsg(child, seen)) return true;
  }
  return false;
}

export async function ensureCsgBrushOpsForPayload(payload) {
  if (!scenePayloadNeedsCsg(payload)) return false;
  await loadCsgBrushOps();
  return true;
}

export function assertCsgBrushOpsReadyForPayload(payload) {
  if (scenePayloadNeedsCsg(payload) && !implementation) {
    requireImplementation();
  }
}
