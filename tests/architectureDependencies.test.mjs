import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".html", ".css"]);
const SCENE_HOST_APPS = new Set(["editor", "player", "shower", "threebox"]);

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".vite"]);

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function collectModuleReferences(file) {
  const source = fs.readFileSync(file, "utf8");
  const references = [];
  const patterns = [
    /(?:from\s*|import\s*\()\s*["']([^"']+)["']/g,
    /(?:src|href)\s*=\s*["']([^"']+\.(?:js|mjs|ts|css))(?:[?#][^"']*)?["']/g,
    /@import\s+(?:url\()?\s*["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) references.push(match[1]);
  }
  return references;
}

function resolveLocalReference(file, reference) {
  if (!reference.startsWith(".")) return null;
  return path.resolve(path.dirname(file), reference);
}

function relative(file) {
  return path.relative(REPO_ROOT, file).replaceAll("\\", "/");
}

test("core never reverse-imports domains, extensions, or host tools", () => {
  const forbiddenRoots = ["domains", "extensions", "tools"].map((dir) => path.join(REPO_ROOT, dir) + path.sep);
  const violations = [];
  for (const file of walkFiles(path.join(REPO_ROOT, "core"))) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if ((resolved && forbiddenRoots.some((root) => resolved.startsWith(root))) || /^threejson\/(?:domains|extensions)(?:\/|$)/.test(reference)) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("domains never import host tools", () => {
  const toolsRoot = path.join(REPO_ROOT, "tools") + path.sep;
  const violations = [];
  for (const file of walkFiles(path.join(REPO_ROOT, "domains"))) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved?.startsWith(toolsRoot)) violations.push(`${relative(file)} -> ${reference}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("scene-host apps do not import another app's internals", () => {
  const sceneHostRoot = path.join(REPO_ROOT, "tools", "scene-host");
  const violations = [];
  for (const app of SCENE_HOST_APPS) {
    for (const file of walkFiles(path.join(sceneHostRoot, app))) {
      for (const reference of collectModuleReferences(file)) {
        const resolved = resolveLocalReference(file, reference);
        if (!resolved?.startsWith(sceneHostRoot + path.sep)) continue;
        const targetApp = path.relative(sceneHostRoot, resolved).split(path.sep)[0];
        if (SCENE_HOST_APPS.has(targetApp) && targetApp !== app) {
          violations.push(`${relative(file)} -> ${reference}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("scene-host shared does not import app internals", () => {
  const sceneHostRoot = path.join(REPO_ROOT, "tools", "scene-host");
  const violations = [];
  for (const file of walkFiles(path.join(sceneHostRoot, "shared"))) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (!resolved?.startsWith(sceneHostRoot + path.sep)) continue;
      const targetApp = path.relative(sceneHostRoot, resolved).split(path.sep)[0];
      if (SCENE_HOST_APPS.has(targetApp)) violations.push(`${relative(file)} -> ${reference}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("independent root host apps do not import scene-host shared", () => {
  const violations = [];
  for (const name of ["room-show.html", "port-show.html"]) {
    const file = path.join(REPO_ROOT, name);
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved?.startsWith(path.join(REPO_ROOT, "tools", "scene-host", "shared") + path.sep)) {
        violations.push(`${name} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("packages/* never reach into core/domains/extensions/tools via relative paths", () => {
  // The whole point of packages/* (e.g. @threejson/host-kit) is to be installable standalone,
  // depending on the *published* threejson/threejson-core/threejson-domains-* surface — never the
  // monorepo's own source tree. A relative import here would silently work in this repo but break
  // for any real consumer who only has node_modules/threejson, not a sibling core/ folder. This is
  // exactly the class of bug found and fixed when packages/host-kit was first extracted.
  const packagesRoot = path.join(REPO_ROOT, "packages");
  if (!fs.existsSync(packagesRoot)) return;
  const forbiddenRoots = ["core", "domains", "extensions", "tools"].map(
    (dir) => path.join(REPO_ROOT, dir) + path.sep
  );
  const violations = [];
  for (const file of walkFiles(packagesRoot)) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved && forbiddenRoots.some((root) => resolved.startsWith(root))) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("apps/* import only via bare package specifiers, never monorepo internals or ThreeBox source", () => {
  // The whole premise of apps/* is that each is a standalone consumer of the *published*
  // @threejson/* packages — exactly what an outside user would `npm install`. So every relative
  // import must stay inside its own app directory; a relative path escaping into core/, domains/,
  // packages/, tools/scene-host (ThreeBox source), or a sibling app would mean the app secretly
  // depends on the monorepo layout and could not be lifted out and published on its own. Cross-
  // package sharing is allowed *only* through bare specifiers (@threejson/*, threejson, three, …),
  // which resolve through node_modules like a real install.
  const appsRoot = path.join(REPO_ROOT, "apps");
  if (!fs.existsSync(appsRoot)) return;
  const violations = [];
  for (const app of fs.readdirSync(appsRoot, { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const appRoot = path.join(appsRoot, app.name) + path.sep;
    for (const file of walkFiles(path.join(appsRoot, app.name))) {
      for (const reference of collectModuleReferences(file)) {
        const resolved = resolveLocalReference(file, reference);
        // Only relative references resolve to a path; bare specifiers (packages) are allowed.
        if (resolved && !resolved.startsWith(appRoot)) {
          violations.push(`${relative(file)} -> ${reference}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("apps/* do not import tools/scene-host (ThreeBox source) via any specifier", () => {
  // Belt-and-suspenders alongside the relative-escape check: catch an accidental bare/aliased
  // reference to the original ThreeBox source, which the apps are explicitly forbidden to depend on.
  const appsRoot = path.join(REPO_ROOT, "apps");
  if (!fs.existsSync(appsRoot)) return;
  const violations = [];
  for (const file of walkFiles(appsRoot)) {
    for (const reference of collectModuleReferences(file)) {
      if (/scene-host/.test(reference) || /(^|\/)tools\//.test(reference)) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("tools/scene-host does not yet depend on packages/* (phase 1: additive only, no behavior change)", () => {
  // Once tools/scene-host is deliberately migrated to import from packages/* (a later, opt-in
  // phase), this test should be removed/updated — for now it guards against that coupling being
  // introduced accidentally while packages/* is still new and unpublished.
  const packagesRoot = path.join(REPO_ROOT, "packages") + path.sep;
  const sceneHostRoot = path.join(REPO_ROOT, "tools", "scene-host");
  if (!fs.existsSync(sceneHostRoot)) return;
  const violations = [];
  for (const file of walkFiles(sceneHostRoot)) {
    for (const reference of collectModuleReferences(file)) {
      const resolved = resolveLocalReference(file, reference);
      if (resolved?.startsWith(packagesRoot) || /^@threejson\/(?!assets)/.test(reference)) {
        violations.push(`${relative(file)} -> ${reference}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
