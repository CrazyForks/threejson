/**
 * Registry for runtime-only logical entities.
 *
 * This is intentionally separate from objectRegistry: a logical entity can occupy a
 * slot inside one shared BufferGeometry and therefore has no corresponding Object3D.
 */
import { resolveRuntimeContext } from "./runtimeContext.js";

function normalizeId(value, label = "id") {
  const id = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!id) {
    throw new Error(`RuntimeEntityRegistry: ${label} must be a non-empty string or number`);
  }
  return id;
}

function normalizeOptionalId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return normalizeId(value, "ownerId");
}

/**
 * @returns {{ register: Function, patch: Function, remove: Function, get: Function, list: Function, clear: Function, dispose: Function }}
 */
export function createRuntimeEntityRegistryStore() {
  /** @type {Map<string, { id: string, ownerId: string|null, kind: string|null, handle: unknown, metadata: object|null }>} */
  const records = new Map();

  function register(record, { replace = true } = {}) {
    if (!record || typeof record !== "object") {
      throw new Error("RuntimeEntityRegistry: record must be an object");
    }
    const id = normalizeId(record.id);
    const existing = records.get(id);
    if (existing && !replace) {
      throw new Error(`RuntimeEntityRegistry: entity "${id}" is already registered`);
    }
    const next = {
      ...existing,
      ...record,
      id,
      ownerId: Object.prototype.hasOwnProperty.call(record, "ownerId")
        ? normalizeOptionalId(record.ownerId)
        : (existing?.ownerId ?? null),
      kind: Object.prototype.hasOwnProperty.call(record, "kind")
        ? (record.kind == null ? null : String(record.kind))
        : (existing?.kind ?? null),
      metadata: Object.prototype.hasOwnProperty.call(record, "metadata")
        ? (record.metadata && typeof record.metadata === "object" ? record.metadata : null)
        : (existing?.metadata ?? null)
    };
    records.set(id, next);
    return next;
  }

  function patch(id, partial = {}) {
    const normalizedId = normalizeId(id);
    const existing = records.get(normalizedId);
    if (!existing) {
      return null;
    }
    return register({ ...existing, ...partial, id: normalizedId });
  }

  function remove(id) {
    return records.delete(normalizeId(id));
  }

  function get(id) {
    return records.get(normalizeId(id)) ?? null;
  }

  function list(options = {}) {
    const ownerId = options.ownerId === undefined ? undefined : normalizeOptionalId(options.ownerId);
    const kind = options.kind === undefined || options.kind === null ? undefined : String(options.kind);
    return Array.from(records.values()).filter((record) => {
      if (ownerId !== undefined && record.ownerId !== ownerId) {
        return false;
      }
      return kind === undefined || record.kind === kind;
    });
  }

  return {
    register,
    patch,
    remove,
    get,
    has: (id) => records.has(normalizeId(id)),
    list,
    clear: () => records.clear(),
    dispose: () => records.clear(),
    get size() {
      return records.size;
    }
  };
}

function resolveStore(runtimeScope) {
  const runtimeContext = resolveRuntimeContext(runtimeScope);
  if (!runtimeContext.entityRegistry) {
    runtimeContext.entityRegistry = createRuntimeEntityRegistryStore();
  }
  return runtimeContext.entityRegistry;
}

export function getRuntimeEntityRegistry(runtimeScope) {
  return resolveStore(runtimeScope);
}

export function registerRuntimeEntity(record, runtimeScope, options) {
  return resolveStore(runtimeScope).register(record, options);
}

export function patchRuntimeEntity(id, partial, runtimeScope) {
  return resolveStore(runtimeScope).patch(id, partial);
}

export function removeRuntimeEntity(id, runtimeScope) {
  return resolveStore(runtimeScope).remove(id);
}

export function getRuntimeEntity(id, runtimeScope) {
  return resolveStore(runtimeScope).get(id);
}

export function listRuntimeEntities(options, runtimeScope) {
  return resolveStore(runtimeScope).list(options);
}
