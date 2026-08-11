import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHtmlTemplate,
  buildPackageJson,
  detectTemplateCapabilities
} from "@threejson/host-kit/js/templateExportBuilders.js";

const OPTIONAL_SPECIFIERS = [
  "fflate",
  "gifuct-js",
  "html2canvas-pro",
  "three-bvh-csg",
  "three-mesh-bvh",
  "troika-three-text"
];

test("minimal exported scene uses the runtime entry and no optional capability", () => {
  const sceneJsonText = JSON.stringify({ objectList: [{ objType: "box" }] });
  const html = buildHtmlTemplate({ sceneJsonText, inlineJson: true });
  const manifest = JSON.parse(buildPackageJson("react", { sceneJsonText }));

  assert.match(html, /from "threejson\/runtime"/);
  for (const specifier of OPTIONAL_SPECIFIERS) {
    assert.equal(html.includes(`"${specifier}"`), false, specifier);
    assert.equal(manifest.dependencies[specifier], undefined, specifier);
  }
});

test("exported templates add only capabilities detected in the scene", () => {
  const scene = {
    objectList: [
      { objType: "text", content: "SDF by default" },
      { objType: "infoPanel", type: "html", text: "<b>status</b>" },
      { objType: "sphere", material: { textureKind: "gif", textureUrl: "status.gif" } },
      { objType: "box", holes: [{ objType: "box" }] }
    ]
  };
  const sceneJsonText = JSON.stringify(scene);
  assert.deepEqual(detectTemplateCapabilities(scene), {
    archive: false,
    animatedGif: true,
    csg: true,
    htmlInfoPanel: true,
    sdfText: true
  });

  const html = buildHtmlTemplate({ sceneJsonText, inlineJson: true });
  const manifest = JSON.parse(buildPackageJson("vue", { sceneJsonText }));
  for (const specifier of OPTIONAL_SPECIFIERS.filter((name) => name !== "fflate")) {
    assert.ok(html.includes(`"${specifier}"`), specifier);
    assert.ok(manifest.dependencies[specifier], specifier);
  }
  assert.equal(html.includes('"fflate"'), false);
  assert.equal(manifest.dependencies.fflate, undefined);
});

test("archive dependency is explicit rather than inferred for JSON templates", () => {
  const manifest = JSON.parse(
    buildPackageJson("electron", { capabilities: { archive: true } })
  );
  assert.equal(manifest.dependencies.fflate, "^0.8.3");
});
