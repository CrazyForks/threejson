import { resolveNumericValue } from "./numericExpression.js";

/** Read [x,y,z], {x,y,z}, or legacy prefixed vector objects. */
export function resolveVector3Value(value, fallback = { x: 0, y: 0, z: 0 }, legacyPrefix = "") {
  const source = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : value && typeof value === "object"
      ? value
      : {};
  const legacy = (axis) => legacyPrefix ? source[`${legacyPrefix}${axis.toUpperCase()}`] : undefined;
  return {
    x: resolveNumericValue(source.x ?? legacy("x"), fallback.x),
    y: resolveNumericValue(source.y ?? legacy("y"), fallback.y),
    z: resolveNumericValue(source.z ?? legacy("z"), fallback.z)
  };
}

export function resolvePosition(value, fallback = { x: 0, y: 0, z: 0 }) {
  return resolveVector3Value(value, fallback);
}

export function resolveRotation(value, fallback = { x: 0, y: 0, z: 0 }) {
  return resolveVector3Value(value, fallback, "rotation");
}

export function resolveScale(value, fallback = { x: 1, y: 1, z: 1 }) {
  return resolveVector3Value(value, fallback, "scale");
}
