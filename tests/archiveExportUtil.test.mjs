import assert from "node:assert/strict";
import test from "node:test";
import {
  collectAssetsFromPayload,
  rewriteRefsToPack,
  walkPayloadForAssetRefs
} from "../core/util/archiveExportUtil.js";

test("walkPayloadForAssetRefs collects lib:// event script references", () => {
  const payload = {
    objectList: [
      {
        threeJsonId: "box-1",
        events: {
          click: { script: "lib://script-toggle" }
        }
      }
    ],
    assetLibrary: [
      {
        threeJsonId: "script-toggle",
        assetKind: "eventScript",
        source: "self.visible = !self.visible;"
      }
    ]
  };
  const refs = [];
  walkPayloadForAssetRefs(payload, ({ ref }) => refs.push(ref));
  assert.deepEqual(refs, ["lib://script-toggle"]);
  assert.equal(
    walkPayloadForAssetRefs(
      { events: { click: { script: "self.visible = !self.visible;" } } },
      ({ ref }) => refs.push(ref)
    ),
    undefined
  );
  assert.equal(refs.length, 1);
});

test("collectAssetsFromPayload tryPack packs inline eventScript lib entries", async () => {
  const payload = {
    objectList: [
      {
        threeJsonId: "box-1",
        events: {
          dblclick: { script: "lib://script-toggle" }
        }
      }
    ],
    assetLibrary: [
      {
        threeJsonId: "script-toggle",
        assetKind: "eventScript",
        source: "run object.set visible true"
      }
    ]
  };
  const collected = await collectAssetsFromPayload(payload, { payload });
  assert.equal(collected.rewrittenCount, 1);
  assert.equal(
    collected.payload.objectList[0].events.dblclick.script,
    "pack://assets/item_1.dsl"
  );
  assert.ok(collected.assets["assets/item_1.dsl"]);
});

test("rewriteRefsToPack rewrites scriptUrl legacy field", () => {
  const payload = {
    events: { click: { scriptUrl: "lib://legacy-script" } }
  };
  const rewriteMap = new Map([["lib://legacy-script", "pack://assets/item_1.dsl"]]);
  const next = rewriteRefsToPack(payload, rewriteMap);
  assert.equal(next.events.click.scriptUrl, "pack://assets/item_1.dsl");
});

test("collectAssetsFromPayload accepts a browser-cache Blob resolver for tryPack", async () => {
  const payload = {
    objectList: [{
      threeJsonId: "textured-box",
      objType: "box",
      material: { textureUrl: "https://textures.test/wood.png" }
    }]
  };
  const result = await collectAssetsFromPayload(payload, {
    payload,
    resolveAsset: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
  });
  assert.equal(result.rewrittenCount, 1);
  assert.match(result.payload.objectList[0].material.textureUrl, /^pack:\/\/assets\/item_1\.png$/);
  assert.deepEqual(Array.from(result.assets["assets/item_1.png"]), [137, 80, 78, 71]);
});
