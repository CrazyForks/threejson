import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  SCENE_PREVIEW_ALLOWED_ORIGINS,
  isScenePreviewAllowedOrigin,
  postScenePreviewMessage,
  resolveScenePreviewPeerOrigin
} from "../tools/scene-host/shared/js/scenePreviewProtocol.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["scene-editor", "scene-player", "scene-shower", "threebox"];
const REQUIRED_PRODUCTION_ORIGINS = [
  "https://threejson.org",
  "https://threebox.org",
  "https://cloud.threebox.org",
  "https://editor.threejson.org",
  "https://player.threejson.org",
  "https://shower.threejson.org"
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function linePattern(value) {
  return new RegExp(`^${String(value).replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")}$`, "m");
}

test("root deployment ignore list excludes non-runtime projects and credentials", () => {
  const ignore = read(".assetsignore");
  for (const entry of [
    "servertmp/",
    "apps/",
    "packages/",
    "tests/",
    "**/dist/",
    "docs/dev/",
    ".claude/",
    ".dev.vars",
    ".env",
    "*.test.json"
  ]) {
    assert.match(ignore, linePattern(entry), entry);
  }
});

test("each React product carries independent Cloudflare deployment hygiene", () => {
  for (const app of APPS) {
    const base = `apps/${app}`;
    const gitignore = read(`${base}/.gitignore`);
    const assetsignore = read(`${base}/.assetsignore`);
    const wrangler = JSON.parse(read(`${base}/wrangler.jsonc`).replace(/^\s*\/\/.*$/gm, ""));
    const manifest = JSON.parse(read(`${base}/package.json`));

    for (const entry of ["node_modules/", "dist/", ".wrangler/", ".dev.vars", ".env", "*.test.json"]) {
      assert.match(gitignore, linePattern(entry), `${base}/.gitignore: ${entry}`);
    }
    for (const entry of ["node_modules/", "src/", ".dev.vars", ".env", "*.test.json"]) {
      assert.match(assetsignore, linePattern(entry), `${base}/.assetsignore: ${entry}`);
    }
    assert.equal(wrangler.assets?.directory, "./dist");
    assert.equal(wrangler.assets?.not_found_handling, "single-page-application");
    assert.equal(manifest.scripts?.deploy, "npm run build && wrangler deploy");
    assert.equal(manifest.scripts?.["versions:upload"], "npm run build && wrangler versions upload");
    assert.ok(manifest.devDependencies?.wrangler, `${base} needs a local wrangler dependency`);
  }
});

test("legacy preview protocol has an explicit allowlist and never falls back to its own origin", () => {
  for (const origin of REQUIRED_PRODUCTION_ORIGINS) {
    assert.equal(isScenePreviewAllowedOrigin(origin), true, origin);
  }
  assert.equal(isScenePreviewAllowedOrigin("https://untrusted.example"), false);
  assert.equal(
    resolveScenePreviewPeerOrigin("https://editor.threejson.org/", "https://threejson.org/"),
    "https://editor.threejson.org"
  );
  assert.equal(
    resolveScenePreviewPeerOrigin("https://untrusted.example/", "https://threejson.org/"),
    null
  );

  const sent = [];
  const target = { closed: false, postMessage: (...args) => sent.push(args) };
  assert.equal(postScenePreviewMessage(target, { action: "load" }), false);
  assert.equal(postScenePreviewMessage(target, { action: "load" }, "https://untrusted.example"), false);
  assert.equal(postScenePreviewMessage(target, { action: "load" }, "https://player.threejson.org"), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], "https://player.threejson.org");
  assert.ok(SCENE_PREVIEW_ALLOWED_ORIGINS.includes("https://player.threejson.org"));
});

test("React applications keep their own explicit handshake sources", () => {
  const sourceFiles = [
    "apps/scene-editor/src/sceneTransferProtocol.js",
    "apps/scene-player/src/scenePreviewProtocol.js",
    "apps/scene-shower/src/sceneTransferProtocol.js",
    "apps/threebox/src/sceneBridgeProtocol.js"
  ];
  for (const file of sourceFiles) {
    const source = read(file);
    for (const origin of REQUIRED_PRODUCTION_ORIGINS) {
      assert.ok(source.includes(origin), `${file} must declare ${origin}`);
    }
    assert.doesNotMatch(source, /from\s*["'][^"']*tools\/scene-host/);
    assert.ok(source.includes("openerOrigin"), `${file} must make the peer origin explicit`);
  }

  assert.match(read("apps/threebox/src/sceneBridgeProtocol.js"), /window\.open\(/);
  assert.match(read("apps/scene-shower/src/sceneTransferProtocol.js"), /window\.open\(/);
  assert.match(read("apps/scene-editor/src/sceneTransferProtocol.js"), /bridgeSession/);
  assert.match(read("apps/scene-player/src/scenePreviewProtocol.js"), /bridgeSession/);
});
