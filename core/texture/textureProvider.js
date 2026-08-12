/**
 * Host-injected texture acquisition protocol. ThreeJSON ships only this neutral contract; search,
 * generation and persistence adapters live in applications or services.
 */
export class TextureAcquisitionProvider {
  constructor(implementation = {}) {
    if (!implementation || typeof implementation !== "object") {
      throw new TypeError("TextureAcquisitionProvider requires an implementation object.");
    }
    this.implementation = implementation;
  }

  async capabilities(context = {}) {
    const fn = this.implementation.capabilities;
    if (typeof fn !== "function") {
      return { search: [], generate: [], persist: [] };
    }
    return normalizeTextureCapabilities(await fn.call(this.implementation, context));
  }

  async search(request, context = {}) {
    const fn = this.implementation.search;
    if (typeof fn !== "function") return { candidates: [] };
    return normalizeCandidateResult(await fn.call(this.implementation, request, context));
  }

  async generate(request, context = {}) {
    const fn = this.implementation.generate;
    if (typeof fn !== "function") return { candidates: [] };
    return normalizeCandidateResult(await fn.call(this.implementation, request, context));
  }

  async persist(request, context = {}) {
    const fn = this.implementation.persist;
    if (typeof fn !== "function") {
      return { candidates: Array.isArray(request?.candidates) ? request.candidates : [] };
    }
    return normalizeCandidateResult(await fn.call(this.implementation, request, context));
  }
}

function stringList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
}

export function normalizeTextureCapabilities(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...source,
    search: stringList(source.search),
    generate: stringList(source.generate),
    persist: stringList(source.persist),
    generationKinds: stringList(source.generationKinds || source.generate),
    pbr: stringList(source.pbr)
  };
}

export function normalizeCandidateResult(value) {
  if (Array.isArray(value)) return { candidates: value.filter(Boolean) };
  if (!value || typeof value !== "object") return { candidates: [] };
  return {
    ...value,
    candidates: Array.isArray(value.candidates) ? value.candidates.filter(Boolean) : []
  };
}

export function asTextureAcquisitionProvider(provider) {
  if (!provider) return null;
  return provider instanceof TextureAcquisitionProvider
    ? provider
    : new TextureAcquisitionProvider(provider);
}

