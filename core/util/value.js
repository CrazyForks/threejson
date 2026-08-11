/** True when a value is present, including false, zero, and an empty string. */
export function hasValue(value) {
  return value !== undefined && value !== null;
}

/** Return `value` when present, otherwise `fallback`. */
export function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

/** Return `value` when it is an array, otherwise `fallback`. */
export function listOr(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}
