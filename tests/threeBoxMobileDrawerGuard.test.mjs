import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the early mobile menu waits for a completed click before opening the drawer", async () => {
  const html = await read("../tools/scene-host/threebox/index.html");
  assert.match(html, /button\.addEventListener\("click", onClick, true\)/);
  assert.doesNotMatch(html, /button\.addEventListener\("pointerdown", onPointerDown/);
});

test("the runtime mobile menu no longer opens during pointerdown", async () => {
  const source = await read("../tools/scene-host/threebox/js/threeBoxViewChrome.js");
  assert.doesNotMatch(source, /mobileMenuBtn\?\.addEventListener\("pointerdown"/);
  assert.match(source, /mobileMenuBtn\?\.addEventListener\("click"/);

  const guardIndex = source.indexOf("armMobileOpenGuard();");
  const openIndex = source.indexOf("leftDockPeek = true;", guardIndex);
  assert.ok(guardIndex >= 0);
  assert.ok(openIndex > guardIndex);
});

test("the freshly opened mobile drawer temporarily rejects pointer interaction", async () => {
  const css = await read("../tools/scene-host/threebox/css/threebox.css");
  assert.match(
    css,
    /#rootContainer\.mobileDockInteractionGuard \.leftDock\s*\{\s*pointer-events:\s*none;\s*\}/
  );
});
