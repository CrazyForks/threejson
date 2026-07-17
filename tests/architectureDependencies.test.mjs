import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".html", ".css"]);
const SCENE_HOST_APPS = new Set(["editor", "player", "shower", "threebox"]);

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
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
