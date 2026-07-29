import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// @threejson/react-ui holds the ready-made dialogs/widgets that more than one app needs. Like the
// @threejson/react tests these import through the published-style specifier and render via SSR, so
// the component body and markup are covered without a browser or a WebGL context.
//
// The localisation assertions matter more than they look: these components render their strings
// through host-kit's t(), whose catalog is empty until initialised. An app that ships its own label
// table (apps/scene-shower does) will otherwise mount them against an empty catalog and get
// key-derived text — a real bug caught only when the dialog reached its second consumer.

test("package exposes the documented component surface", async () => {
  const mod = await import("@threejson/react-ui");
  assert.equal(typeof mod.MeshExportDialog, "function");
  assert.equal(typeof mod.SceneTreePanel, "function");
});

test("MeshExportDialog renders an aria-correct modal with every supported format", async () => {
  const { MeshExportDialog } = await import("@threejson/react-ui");
  const { MESH_EXPORT_FORMATS } = await import("@threejson/host-kit/js/meshExport.js");
  const html = renderToStaticMarkup(createElement(MeshExportDialog, { getSceneSnapshot: () => null }));

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  // The <select> is labelled by a real <label for>, not just placeholder text.
  assert.match(html, /<label for="tjUi-meshFormat"/);
  assert.match(html, /<select id="tjUi-meshFormat"/);

  for (const entry of MESH_EXPORT_FORMATS) {
    assert.ok(html.includes(`value="${entry.value}"`), `format ${entry.value} missing from the picker`);
  }
  // GLB is the default selection.
  assert.match(html, /<option selected="" value="glb"|value="glb" selected/);
});

test("MeshExportDialog emits only tjUi-* class names so apps can restyle it", async () => {
  const { MeshExportDialog } = await import("@threejson/react-ui");
  const html = renderToStaticMarkup(createElement(MeshExportDialog, { getSceneSnapshot: () => null }));
  const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
  assert.ok(classes.length > 0, "component emitted no class names at all");
  const foreign = classes.filter((name) => !name.startsWith("tjUi-"));
  assert.deepEqual(foreign, [], `non-namespaced class names would collide with host app CSS: ${foreign}`);
});

test("MeshExportDialog renders localised strings once the host catalog is loaded", async () => {
  const { MeshExportDialog } = await import("@threejson/react-ui");
  const { setHostLocale } = await import("@threejson/react");

  await setHostLocale("en-US");
  const en = renderToStaticMarkup(createElement(MeshExportDialog, { getSceneSnapshot: () => null }));
  assert.match(en, /Export Third-Party Model/);
  assert.match(en, /GLB \(Recommended\)/);
  // Guards the regression this test was written for: "Title" is what englishizeKey() produces from
  // the tail of "threebox.meshExport.title" when the catalog never loaded.
  assert.ok(!/>Title</.test(en), "title degraded to key-derived text — host catalog was not loaded");

  await setHostLocale("zh-CN");
  const zh = renderToStaticMarkup(createElement(MeshExportDialog, { getSceneSnapshot: () => null }));
  assert.match(zh, /导出三方模型/);
  assert.match(zh, /GLB（推荐）/);

  await setHostLocale("en-US");
});

test("MeshExportDialog reports a missing scene instead of throwing", async () => {
  const { MeshExportDialog } = await import("@threejson/react-ui");
  // getSceneSnapshot returning null is the normal "viewport not ready" case; rendering must not
  // throw, and the export button stays available for a later retry.
  const html = renderToStaticMarkup(createElement(MeshExportDialog, { getSceneSnapshot: () => null }));
  assert.ok(!html.includes("tjUi-error"), "error panel shown before the user attempted an export");
  assert.match(html, /<button[^>]*class="tjUi-primary"/);
});

test("styles.css is shipped and themable via custom properties", async () => {
  const { readFile } = await import("node:fs/promises");
  const url = new URL("../packages/react-ui/src/styles.css", import.meta.url);
  const css = await readFile(url, "utf8");
  // The sheet is optional sugar: every colour goes through a --tjUi-* custom property with a
  // fallback, so an app can retheme it without overriding rules.
  assert.match(css, /--tjUi-/);
  assert.match(css, /\.tjUi-overlay/);
  assert.match(css, /\.tjUi-dialog\b/);
});

test("SceneTreePanel renders the hierarchy with accessible tree semantics", async () => {
  const { SceneTreePanel } = await import("@threejson/react-ui");
  const { setHostLocale } = await import("@threejson/react");
  await setHostLocale("en-US");

  const node = (over) => ({ uuid: "u" + Math.random(), name: "", type: "Mesh", visible: true, children: [], ...over });
  const scene = {
    children: [
      node({
        name: "vehicle",
        type: "Group",
        userData: { objJson: { threeJsonId: "vehicle-1" } },
        children: [node({ name: "wheel", userData: { objJson: { threeJsonId: "wheel-1" } } })]
      }),
      node({ name: "gizmo", type: "TransformControls" })
    ]
  };

  const html = renderToStaticMarkup(createElement(SceneTreePanel, { scene, selectedKey: "wheel-1" }));
  assert.match(html, /role="tree"/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, />vehicle</);
  assert.match(html, />wheel</);
  // The runtime-only object is filtered by the model, so it must not reach the markup.
  assert.ok(!html.includes("gizmo"), "TransformControls leaked into the tree");
  // Count reflects filtered nodes, and the {count} parameter was interpolated.
  assert.match(html, /2 objects/);
  // Controlled selection marks exactly one row.
  assert.equal((html.match(/tjUi-treeRowSelected/g) || []).length, 1);
  assert.match(html, /aria-current="true"/);
});

test("SceneTreePanel renders an empty state rather than failing without a scene", async () => {
  const { SceneTreePanel } = await import("@threejson/react-ui");
  const { setHostLocale } = await import("@threejson/react");
  await setHostLocale("en-US");
  const html = renderToStaticMarkup(createElement(SceneTreePanel, { scene: null }));
  assert.match(html, /tjUi-treeEmpty/);
  assert.match(html, /No objects in this scene/);
  // Guards the englishizeKey trap: a missing catalog entry would render "Empty" here.
  assert.ok(!/>Empty</.test(html));
});

test("SceneTreePanel localises to zh-CN", async () => {
  const { SceneTreePanel } = await import("@threejson/react-ui");
  const { setHostLocale } = await import("@threejson/react");
  await setHostLocale("zh-CN");
  const html = renderToStaticMarkup(createElement(SceneTreePanel, { scene: null }));
  assert.match(html, /当前场景没有对象/);
  await setHostLocale("en-US");
});
