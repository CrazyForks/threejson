import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSETS_PACKAGE_VERSION,
  DEFAULT_CDN_ASSETS_BASE,
  LOCAL_ASSETS_BASE,
  assetUrl,
  getAssetsBaseUrl,
  resolveAssetsBaseFromLoad,
  resolvePublicAssetUrl,
  setAssetsBaseUrl
} from "../core/util/assetsBase.js";

test("default assets base points at jsDelivr CDN", () => {
  assert.equal(getAssetsBaseUrl(), DEFAULT_CDN_ASSETS_BASE);
  assert.ok(DEFAULT_CDN_ASSETS_BASE.includes(`@threejson/assets@${ASSETS_PACKAGE_VERSION}`));
});

test("setAssetsBaseUrl and assetUrl join segments", () => {
  setAssetsBaseUrl(LOCAL_ASSETS_BASE);
  assert.equal(assetUrl("textures/foo.png"), "/assets/textures/foo.png");
  setAssetsBaseUrl(DEFAULT_CDN_ASSETS_BASE);
});

test("resolvePublicAssetUrl rewrites /assets/ prefix", () => {
  setAssetsBaseUrl(LOCAL_ASSETS_BASE);
  assert.equal(
    resolvePublicAssetUrl("/assets/textures/device/cabinet/cabinet_left_door.png"),
    "/assets/textures/device/cabinet/cabinet_left_door.png"
  );
  setAssetsBaseUrl(DEFAULT_CDN_ASSETS_BASE);
  assert.ok(
    resolvePublicAssetUrl("/assets/textures/device/cabinet/cabinet_left_door.png").includes(
      "textures/device/cabinet/cabinet_left_door.png"
    )
  );
});

test("resolvePublicAssetUrl leaves absolute https URLs unchanged", () => {
  const url = "https://example.com/textures/foo.png";
  assert.equal(resolvePublicAssetUrl(url), url);
});

test("resolveAssetsBaseFromLoad prefers createJsonScene options over sceneConfig", () => {
  const payload = { sceneConfig: { assetsBase: "/assets" } };
  assert.equal(resolveAssetsBaseFromLoad(payload, {}), "/assets");
  assert.equal(resolveAssetsBaseFromLoad(payload, { assetsBase: "https://cdn.example.com/pkg" }), "https://cdn.example.com/pkg");
});
