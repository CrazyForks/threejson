/**
 * Lazy-load optional browser ESM dependencies (`import()`, not Node).
 * Used for host-supplied capability specifiers; throws on failure for upstream fallback.
 * Package-owned optional peers use literal dynamic imports so bundlers can emit lazy chunks.
 */

/** @type {Map<string, Promise<unknown>>} */
const specifierCache = new Map();

/**
 * @param {string} specifier import map / bare node_modules specifier or relative URL
 * @returns {Promise<unknown>}
 */
export function loadEsmModule(specifier) {
  if (!specifierCache.has(specifier)) {
    specifierCache.set(
      specifier,
      import(specifier).catch((err) => {
        specifierCache.delete(specifier);
        throw err;
      })
    );
  }
  return specifierCache.get(specifier);
}

let sdfTextModulePromise = null;

/** @returns {Promise<typeof import("../builder/text/sdfText.js")>} */
export function loadSdfTextModule() {
  if (!sdfTextModulePromise) {
    sdfTextModulePromise = import("../builder/text/sdfText.js").catch((err) => {
      sdfTextModulePromise = null;
      throw err;
    });
  }
  return sdfTextModulePromise;
}
