import { recordHasExplicitRotation } from "./shapeGeometryUtil.js";
import { resolvePosition, resolveRotation, resolveScale } from "../util/vectorValue.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function normalizePosition(position = {}) {
  return resolvePosition(position);
}

function normalizeRotation(rotation = {}) {
  return resolveRotation(rotation);
}

function normalizeScale(scale = {}) {
  return resolveScale(scale);
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} record
 */
export function applyParallelToOrRotation(object3D, record = {}) {
  const position = normalizePosition(record.position);
  object3D.position.set(position.x, position.y, position.z);

  const scale = normalizeScale(record.scale);
  object3D.scale.set(scale.x, scale.y, scale.z);

  if (recordHasExplicitRotation(record)) {
    const rotation = normalizeRotation(record.rotation);
    object3D.rotation.set(rotation.x, rotation.y, rotation.z);
    return;
  }

  const parallelTo = typeof record.parallelTo === "string" ? record.parallelTo.trim().toLowerCase() : "xy";
  if (parallelTo === "xz") {
    object3D.rotation.set(-Math.PI / 2, 0, 0);
  } else if (parallelTo === "yz") {
    object3D.rotation.set(0, Math.PI / 2, 0);
  } else {
    object3D.rotation.set(0, 0, 0);
  }
}
