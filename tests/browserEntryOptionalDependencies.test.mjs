import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectStaticModuleReferences(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const references = [];
  const patterns = [
    /^[ \t]*import\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']/gm,
    /^[ \t]*export\s+(?:\*|\{[\s\S]*?\})\s+from\s*["']([^"']+)["']/gm
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) references.push(match[1]);
  }
  return references;
}

function resolveLocalModule(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const resolved = path.resolve(path.dirname(importer), specifier);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  if (!path.extname(resolved) && fs.existsSync(`${resolved}.js`)) return `${resolved}.js`;
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const indexFile = path.join(resolved, "index.js");
    if (fs.existsSync(indexFile)) return indexFile;
  }
  throw new Error(`Cannot resolve static module ${specifier} from ${path.relative(REPO_ROOT, importer)}`);
}

function collectTransitiveBareSpecifiers(entryFile) {
  const pending = [entryFile];
  const visited = new Set();
  const bareSpecifiers = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of collectStaticModuleReferences(source)) {
      const localFile = resolveLocalModule(file, specifier);
      if (localFile) pending.push(localFile);
      else bareSpecifiers.add(specifier);
    }
  }
  return bareSpecifiers;
}

function readImportMap(htmlFile) {
  const html = fs.readFileSync(htmlFile, "utf8");
  const match = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(match, `${path.relative(REPO_ROOT, htmlFile)} must contain an import map`);
  return JSON.parse(match[1]).imports || {};
}

function importMapCovers(imports, specifier) {
  if (Object.prototype.hasOwnProperty.call(imports, specifier)) return true;
  return Object.keys(imports).some((key) => key.endsWith("/") && specifier.startsWith(key));
}

test("ordinary browser entries keep optional fflate outside their static dependency graph", () => {
  const entries = [
    {
      entry: path.join(REPO_ROOT, "core", "index.js"),
      demo: path.join(REPO_ROOT, "examples", "html-demo", "track-00-runtime", "00-01-minimal-mesh.html")
    },
    {
      entry: path.join(REPO_ROOT, "builtins", "full.js"),
      demo: path.join(REPO_ROOT, "examples", "html-demo", "track-00-runtime", "00-02-primitives-materials.html")
    }
  ];

  for (const { entry, demo } of entries) {
    const bareSpecifiers = collectTransitiveBareSpecifiers(entry);
    const imports = readImportMap(demo);
    assert.equal(bareSpecifiers.has("fflate"), false, `${path.relative(REPO_ROOT, entry)} must keep archive compression lazy`);
    const missing = [...bareSpecifiers].filter((specifier) => !importMapCovers(imports, specifier)).sort();
    assert.deepEqual(
      missing,
      [],
      `${path.relative(REPO_ROOT, demo)} is missing mappings for static browser dependencies`
    );
  }
});

test("archive support has an explicit package subpath and scene-editor opts into it", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(packageJson.exports?.["./archive"], "./core/archive/index.js");

  const coreIndex = fs.readFileSync(path.join(REPO_ROOT, "core", "index.js"), "utf8");
  assert.match(coreIndex, /archive\/lazyArchiveApi\.js/);
  assert.doesNotMatch(coreIndex, /export\s+\*\s+from\s+["']\.\/archive\/tjz(?:Packager|Archive)\.js["']/);

  const appSource = fs.readFileSync(path.join(REPO_ROOT, "apps", "scene-editor", "src", "App.jsx"), "utf8");
  const exportSource = fs.readFileSync(
    path.join(REPO_ROOT, "apps", "scene-editor", "src", "lib", "editorTjzExport.js"),
    "utf8"
  );
  assert.match(appSource, /from\s+["']threejson\/archive["']/);
  assert.match(exportSource, /from\s+["']threejson\/archive["']/);
});
