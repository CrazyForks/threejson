/**
 * Backward-compatible archive facade for the main `threejson` / `threejson/core` entry points.
 *
 * Archive support depends on the bare `fflate` package. Keeping the real archive modules behind
 * dynamic imports prevents ordinary unbundled browser scenes from resolving that optional
 * dependency before they actually use a .tjz API.
 */
let packagerModulePromise = null;
let archiveModulePromise = null;

function loadPackagerModule() {
  if (!packagerModulePromise) {
    packagerModulePromise = import("./tjzPackager.js");
  }
  return packagerModulePromise;
}

function loadArchiveModule() {
  if (!archiveModulePromise) {
    archiveModulePromise = import("./tjzArchive.js");
  }
  return archiveModulePromise;
}

async function packTjzArchive(...args) {
  const module = await loadPackagerModule();
  return module.packTjzArchive(...args);
}

async function parseTjzArchiveForScene(...args) {
  const module = await loadArchiveModule();
  return module.parseTjzArchiveForScene(...args);
}

async function inspectTjzArchiveEntry(...args) {
  const module = await loadArchiveModule();
  return module.inspectTjzArchiveEntry(...args);
}

async function isTjzLike(...args) {
  const module = await loadArchiveModule();
  return module.isTjzLike(...args);
}

export {
  inspectTjzArchiveEntry,
  isTjzLike,
  packTjzArchive,
  parseTjzArchiveForScene
};
