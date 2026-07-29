/**
 * Runtime-only, slot-backed BufferGeometry batches for high-frequency visualizations.
 *
 * This module deliberately has no scene JSON, domain, or application semantics. A host
 * owns the mapping from its logical model to stable entity IDs, chooses materials/shaders,
 * and decides when to persist state. The batch only manages dense typed-array slots and
 * marks the smallest accumulated GPU upload ranges on `commit()`.
 */
import * as THREE from "three";

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function normalizeEntityId(value) {
  const id = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!id) {
    throw new Error("DynamicGeometryBatch: entity id must be a non-empty string or number");
  }
  return id;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDefaultValue(value, itemSize) {
  const source = ArrayBuffer.isView(value) || Array.isArray(value) ? Array.from(value) : [value];
  const normalized = new Float32Array(itemSize);
  for (let index = 0; index < itemSize; index += 1) {
    normalized[index] = toFiniteNumber(source[Math.min(index, source.length - 1)], 0);
  }
  return normalized;
}

function normalizeAttributeSchema(attributes, verticesPerEntity) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    throw new Error("DynamicGeometryBatch: attributes must be an object keyed by attribute name");
  }
  const entries = Object.entries(attributes);
  if (entries.length === 0) {
    throw new Error("DynamicGeometryBatch: at least one attribute is required");
  }
  const schema = [];
  for (const [name, rawDefinition] of entries) {
    const definition = rawDefinition && typeof rawDefinition === "object" ? rawDefinition : {};
    const itemSize = normalizePositiveInteger(definition.itemSize, 1);
    schema.push({
      name,
      itemSize,
      defaultValue: normalizeDefaultValue(definition.defaultValue ?? 0, itemSize),
      normalized: definition.normalized === true,
      componentCount: verticesPerEntity * itemSize
    });
  }
  return schema;
}

function normalizeAttributeValue(value, state, verticesPerEntity) {
  const expectedLength = state.itemSize * verticesPerEntity;
  let source;
  if (typeof value === "number") {
    source = [value];
  } else if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    source = Array.from(value);
  } else if (value && typeof value === "object") {
    const vector = [value.x, value.y, value.z, value.w];
    const color = [value.r, value.g, value.b, value.a];
    const candidate = vector.some((entry) => entry !== undefined) ? vector : color;
    source = candidate.slice(0, state.itemSize);
  } else {
    throw new Error(`DynamicGeometryBatch: attribute "${state.name}" must be a number, array, typed array, or vector-like object`);
  }

  if (source.length === 1) {
    return new Float32Array(expectedLength).fill(toFiniteNumber(source[0], 0));
  }
  if (source.length === state.itemSize) {
    const out = new Float32Array(expectedLength);
    for (let vertex = 0; vertex < verticesPerEntity; vertex += 1) {
      out.set(source.map((entry) => toFiniteNumber(entry, 0)), vertex * state.itemSize);
    }
    return out;
  }
  if (source.length !== expectedLength) {
    throw new Error(
      `DynamicGeometryBatch: attribute "${state.name}" expects ${state.itemSize} or ${expectedLength} values, received ${source.length}`
    );
  }
  return Float32Array.from(source, (entry) => toFiniteNumber(entry, 0));
}

function createAttributeState(geometry, definition, capacity) {
  const array = new Float32Array(capacity * definition.componentCount);
  const attribute = new THREE.BufferAttribute(array, definition.itemSize, definition.normalized);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(definition.name, attribute);
  return {
    ...definition,
    array,
    attribute,
    dirtyStart: Number.POSITIVE_INFINITY,
    dirtyEnd: 0,
    needsFullUpload: true
  };
}

function markDirty(state, start, end) {
  state.dirtyStart = Math.min(state.dirtyStart, start);
  state.dirtyEnd = Math.max(state.dirtyEnd, end);
}

function writeDefaultSlot(state, slot) {
  const offset = slot * state.componentCount;
  for (let vertex = 0; vertex < state.componentCount / state.itemSize; vertex += 1) {
    state.array.set(state.defaultValue, offset + vertex * state.itemSize);
  }
  markDirty(state, offset, offset + state.componentCount);
}

function writeAttributeSlot(state, slot, values) {
  const offset = slot * state.componentCount;
  state.array.set(values, offset);
  markDirty(state, offset, offset + state.componentCount);
}

function copySlot(state, sourceSlot, targetSlot) {
  if (sourceSlot === targetSlot) {
    return;
  }
  const sourceOffset = sourceSlot * state.componentCount;
  const targetOffset = targetSlot * state.componentCount;
  state.array.copyWithin(targetOffset, sourceOffset, sourceOffset + state.componentCount);
  markDirty(state, targetOffset, targetOffset + state.componentCount);
}

function markAttributeForUpload(state) {
  const start = state.needsFullUpload ? 0 : state.dirtyStart;
  const end = state.needsFullUpload ? state.array.length : state.dirtyEnd;
  if (!Number.isFinite(start) || end <= start) {
    return null;
  }
  if (typeof state.attribute.clearUpdateRanges === "function") {
    state.attribute.clearUpdateRanges();
  }
  if (typeof state.attribute.addUpdateRange === "function") {
    state.attribute.addUpdateRange(start, end - start);
  } else if (state.attribute.updateRange) {
    state.attribute.updateRange.offset = start;
    state.attribute.updateRange.count = end - start;
  }
  state.attribute.needsUpdate = true;
  state.dirtyStart = Number.POSITIVE_INFINITY;
  state.dirtyEnd = 0;
  state.needsFullUpload = false;
  return { name: state.name, start, count: end - start };
}

/**
 * Create a dense slot-backed BufferGeometry.
 *
 * Values passed to `set()`/`patch()` are flat per-entity attribute values. For an
 * attribute of itemSize 3 and verticesPerEntity 2, pass either `[r, g, b]` to repeat
 * on both vertices or `[r0, g0, b0, r1, g1, b1]` for two independent vertex values.
 *
 * @param {{
 *   capacity?: number,
 *   verticesPerEntity?: number,
 *   attributes: Record<string, {itemSize?: number, defaultValue?: number|number[], normalized?: boolean}>,
 *   geometry?: THREE.BufferGeometry,
 *   disposeGeometry?: boolean
 * }} options
 */
export function createDynamicGeometryBatch(options = {}) {
  const verticesPerEntity = normalizePositiveInteger(options.verticesPerEntity, 1);
  const schema = normalizeAttributeSchema(options.attributes, verticesPerEntity);
  const geometry = options.geometry?.isBufferGeometry ? options.geometry : new THREE.BufferGeometry();
  let capacity = normalizePositiveInteger(options.capacity, 16);
  let activeCount = 0;
  let disposed = false;
  const entityIds = [];
  const slotByEntityId = new Map();
  const states = new Map();

  for (const definition of schema) {
    states.set(definition.name, createAttributeState(geometry, definition, capacity));
  }
  geometry.setDrawRange(0, 0);

  function assertUsable() {
    if (disposed) {
      throw new Error("DynamicGeometryBatch: batch has been disposed");
    }
  }

  function ensureCapacity(requiredCount) {
    if (requiredCount <= capacity) {
      return false;
    }
    let nextCapacity = capacity;
    while (nextCapacity < requiredCount) {
      nextCapacity *= 2;
    }
    for (const state of states.values()) {
      const nextArray = new Float32Array(nextCapacity * state.componentCount);
      nextArray.set(state.array);
      state.array = nextArray;
      state.attribute = new THREE.BufferAttribute(nextArray, state.itemSize, state.normalized);
      state.attribute.setUsage(THREE.DynamicDrawUsage);
      state.needsFullUpload = true;
      state.dirtyStart = 0;
      state.dirtyEnd = nextArray.length;
      geometry.setAttribute(state.name, state.attribute);
    }
    capacity = nextCapacity;
    return true;
  }

  /**
   * @param {boolean} resetMissing when true, attributes absent from `values` are written back to
   *   their schema default (full-replace semantics); when false they keep their current slot value
   *   (merge semantics).
   */
  function applyValues(slot, values, resetMissing) {
    const source = values && typeof values === "object" ? values : {};
    for (const [name, state] of states) {
      if (Object.prototype.hasOwnProperty.call(source, name)) {
        writeAttributeSlot(state, slot, normalizeAttributeValue(source[name], state, verticesPerEntity));
      } else if (resetMissing) {
        writeDefaultSlot(state, slot);
      }
    }
  }

  /** Allocate the entity's slot if it is new. Returns `{ slot, isNew }`. */
  function resolveSlot(id) {
    const existing = slotByEntityId.get(id);
    if (existing !== undefined) {
      return { slot: existing, isNew: false };
    }
    ensureCapacity(activeCount + 1);
    const slot = activeCount;
    activeCount += 1;
    entityIds[slot] = id;
    slotByEntityId.set(id, slot);
    return { slot, isNew: true };
  }

  /**
   * Allocate or **replace** an entity: attributes omitted from `values` are reset to their schema
   * defaults, so a slot never inherits values from this entity's previous state (nor from an
   * earlier entity whose slot was reused by swap-removal).
   */
  function set(entityId, values = {}) {
    assertUsable();
    const { slot } = resolveSlot(normalizeEntityId(entityId));
    applyValues(slot, values, true);
    geometry.setDrawRange(0, activeCount * verticesPerEntity);
    return slot;
  }

  /**
   * Change **only** the supplied attributes, leaving the rest of the entity's current values
   * untouched. A patch that allocates a new slot still initializes the omitted attributes to their
   * defaults — otherwise the fresh entity would inherit stale bytes from a swap-removed predecessor.
   */
  function patch(entityId, values = {}) {
    assertUsable();
    const { slot, isNew } = resolveSlot(normalizeEntityId(entityId));
    applyValues(slot, values, isNew);
    geometry.setDrawRange(0, activeCount * verticesPerEntity);
    return slot;
  }

  function remove(entityId) {
    assertUsable();
    const id = normalizeEntityId(entityId);
    const slot = slotByEntityId.get(id);
    if (slot === undefined) {
      return false;
    }
    const lastSlot = activeCount - 1;
    const movedEntityId = entityIds[lastSlot];
    if (slot !== lastSlot) {
      for (const state of states.values()) {
        copySlot(state, lastSlot, slot);
      }
      entityIds[slot] = movedEntityId;
      slotByEntityId.set(movedEntityId, slot);
    }
    entityIds.pop();
    slotByEntityId.delete(id);
    activeCount -= 1;
    geometry.setDrawRange(0, activeCount * verticesPerEntity);
    return true;
  }

  function clear() {
    assertUsable();
    entityIds.length = 0;
    slotByEntityId.clear();
    activeCount = 0;
    geometry.setDrawRange(0, 0);
  }

  function commit() {
    assertUsable();
    const attributeRanges = [];
    for (const state of states.values()) {
      const range = markAttributeForUpload(state);
      if (range) {
        attributeRanges.push(range);
      }
    }
    return {
      entityCount: activeCount,
      vertexCount: activeCount * verticesPerEntity,
      capacity,
      attributeRanges
    };
  }

  function getAttributeState(name) {
    return states.get(name) ?? null;
  }

  function dispose() {
    if (disposed) {
      return;
    }
    slotByEntityId.clear();
    entityIds.length = 0;
    activeCount = 0;
    if (options.disposeGeometry !== false) {
      geometry.dispose();
    }
    disposed = true;
  }

  return {
    geometry,
    verticesPerEntity,
    set,
    patch,
    remove,
    clear,
    commit,
    dispose,
    has: (entityId) => slotByEntityId.has(normalizeEntityId(entityId)),
    getSlot: (entityId) => slotByEntityId.get(normalizeEntityId(entityId)) ?? -1,
    getEntityIdAt: (slot) => entityIds[Number(slot)] ?? null,
    getAttribute: (name) => geometry.getAttribute(name) ?? null,
    getAttributeState,
    getEntityIds: () => entityIds.slice(),
    get entityCount() {
      return activeCount;
    },
    get capacity() {
      return capacity;
    },
    get disposed() {
      return disposed;
    }
  };
}

/** Create a one-vertex-per-entity dynamic batch, useful for point-like primitives. */
export function createDynamicPointBatch(options = {}) {
  return createDynamicGeometryBatch({ ...options, verticesPerEntity: 1 });
}

/** Create a two-vertex-per-entity dynamic batch, useful for line-segment-like primitives. */
export function createDynamicSegmentBatch(options = {}) {
  return createDynamicGeometryBatch({ ...options, verticesPerEntity: 2 });
}
