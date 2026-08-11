# ThreeJSON

[中文](./README_ZH.md) | [English](./README.md)

[![CI](https://github.com/nnrj/threejson/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/nnrj/threejson/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/nnrj/threejson)](./LICENSE)

JSON-driven [Three.js](https://threejs.org/) scene runtime: build 3D scenes from configuration instead of hand-writing large chunks of Three.js boilerplate.

**Official website**：https://threejson.org/

**Repository**: [github.com/nnrj/threejson](https://github.com/nnrj/threejson) · **Issues**: [GitHub Issues](https://github.com/nnrj/threejson/issues)

**npm**：[threejson - npm](https://www.npmjs.com/package/threejson) 、[@threejson/assets - npm](https://www.npmjs.com/package/@threejson/assets?activeTab=versions) 

**Demos**: [ThreeJSON Examples](https://threejson.org/website/#/examples)   SceneEditor: [ThreeJSON SceneEditor](https://threejson.org/tools/scene-host/editor/)



**Exact description:**

ThreeJSON is a JSON-driven declarative scene runtime for Three.js, designed for persistent, mutable and extensible 3D worlds — from human-authored scenes to AI and Agent-driven generation and control.

## Use in your project

```bash
npm install threejson
```

In addition, certain built-in models rely on the assets package (which contains textures, sample scene JSONs, etc.). By default, no manual setup is required as ThreeJSON will automatically fetch them via CDN. 

If you prefer to host or use them locally, you can install the assets package separately: 

```bash
npm install @threejson/assets
```

## Development environment

To run tests, examples, and external tools (agent bridges, MCP) in this repo, use **Node.js 24+**.

```bash
git clone https://github.com/nnrj/threejson.git
cd threejson
nvm use          # reads .nvmrc
npm ci && npm test
```

See **[`docs/zh/development.md`](docs/zh/development.md)** (Chinese; English: [`docs/en/development.md`](docs/en/development.md)).

## Use in your project

```bash
npm install threejson
```

In addition, certain built-in models rely on the assets package (which contains textures, sample scene JSONs, etc.). By default, no manual setup is required as ThreeJSON will automatically fetch them via CDN. 

If you prefer to host or use them locally, you can install the assets package separately: 

```bash
npm install @threejson/assets
```

### The philosophy of ThreeJSON, distilled into four lines:

> **Scene as Data** — The scene is data.
>  **Runtime as Engine** — The runtime is the engine.
>  **Domain as Extension** — Domains are extensions.
>  **Agent as Operator** — Agents are operators.

**In plain English:**

> **You define the world. AI creates and reshapes it. ThreeJSON brings it to life.**

## Contributing and AI-generated code

This project **allows** AI-assisted contributions, subject to the **AI-generated code guidelines** in [`docs/zh/development.md`](docs/zh/development.md) (keep docs in sync, human-reviewed plans, attach `docs/dev/plans/` with each submission). See also [`docs/dev/plans/README.md`](docs/dev/plans/README.md).

## Documentation

See **[`docs/en/README.md`](docs/en/README.md)** for the full caller guide, JSON format, and API reference.

If you want to understand the design of `domains/`, how `domainModelList` works, or how to create a custom business domain, see **[`docs/en/domains.md`](docs/en/domains.md)**.

## Install from npm (package name: `threejson`)

Peer dependencies must be installed in your app (versions should satisfy the `peerDependencies` field in [`package.json`](package.json)):

- **Three.js**: `>= 0.179.0` (recommended **0.184.x**). See [`docs/zh/three-compat.md`](docs/zh/three-compat.md) (Chinese; version matrix and workarounds).

```bash
npm install threejson three @tweenjs/tween.js
```

The minimal scene runtime has no mandatory archive, GIF, HTML rasterization, CSG, or SDF-text package. Install an optional peer only when the scene uses its capability:

- `.tjz` archives: `fflate`
- GIF textures: `gifuct-js`
- HTML `infoPanel` textures: `html2canvas-pro`
- CSG (`joins`, `inters`, or `holes`): `three-bvh-csg three-mesh-bvh`
- SDF scene text: `troika-three-text`

For a normal JSON scene, prefer the narrow runtime entry:

```js
import { createJsonScene } from "threejson/runtime";
```

Use the aggregate entry only when you also need built-in business domains or its compatibility API surface:

```js
import { createSceneRuntime, deployMesh, door } from "threejson";
import { applyJsonPatchToObjectDescriptor } from "threejson/patch";
import { applyJsonPatchToJsonDocument } from "threejson/patch-core";
```

For pure core without built-in domains: `import { createSceneRuntime } from "threejson/core"`. To control registration order yourself, add `import "threejson/builtins/register"`.

### Static assets (textures / models / scene JSON)

After `npm install`, built-in domains and `/assets/...` paths in scene JSON **default** to the active base first, then fall back to jsDelivr [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) (version pinned in runtime `ASSETS_PACKAGE_VERSION`). You do not need to install the assets package for CDN fallback.

**Use a local static mount** (clone, self-hosted):

```js
import { createJsonScene } from "threejson/runtime";
import { LOCAL_ASSETS_BASE, setAssetsBaseUrl } from "threejson/assets";

setAssetsBaseUrl(LOCAL_ASSETS_BASE); // "/assets"

await createJsonScene(payload, {
  canvas,
  assetsBase: "/assets" // or sceneConfig.assetsBase in JSON
});
```

Priority (high → low): `createJsonScene({ assetsBase })` → `sceneConfig.assetsBase` → `setAssetsBaseUrl()` → active-base-first CDN fallback. Keep `/assets/textures/...` in JSON; the loader rewrites against the active base first and falls back to CDN. Full `https://` URLs are unchanged.

Bundlers (Vite, Webpack, etc.) resolve `three` and addons from `node_modules`.

**npm + bundler vs import map + CDN**: npm builds give **locked versions**, **reproducible installs**, and tree-shaking, at the cost of a build step. Import maps pointing at **esm.sh / jsdelivr** work in **no-build** HTML demos but depend on **CDN availability**; pin major versions in URLs to reduce drift.

## Use without npm (clone + static server)

Clone the repo and serve it over HTTP (e.g. Live Server). For ordinary JSON scenes, map **`threejson/runtime`** → [`core/runtime.js`](core/runtime.js), plus `three`, `three/examples/jsm/`, and `@tweenjs/tween.js`. Map the aggregate **`threejson`** → [`builtins/full.js`](builtins/full.js) only when built-in business domains are needed. Optional capability packages are mapped only when used; in particular, SDF text needs `troika-three-text`, not `fflate`. See [`examples/html-demo/README.md`](examples/html-demo/README.md) and [`docs/en/quick-start.md`](docs/en/quick-start.md).

## Quick Local Preview

After starting a static server, open [`index.html`](index.html) at the repo root. It redirects to [`website/index.html`](website/index.html). The tutorial index is [`examples/html-demo/demo.html`](examples/html-demo/demo.html), which aggregates the `examples/html-demo/*.html` samples together with the root-level integrated pages such as [`room-show.html`](room-show.html), [`tools/scene-host/editor/index.html`](tools/scene-host/editor/index.html), [`tools/scene-host/player/index.html`](tools/scene-host/player/index.html), and [`port-show.html`](port-show.html).

## License

[MIT](./LICENSE)

## Trademark

"ThreeJSON" and the ThreeJSON logo are trademarks of the ThreeJSON project. The MIT license covers the source code only and does not grant rights to the ThreeJSON name/logo. See [TRADEMARK.md](./TRADEMARK.md) (中文版：[TRADEMARK.zh-CN.md](./TRADEMARK.zh-CN.md)) for usage guidelines and how to report impersonation.
