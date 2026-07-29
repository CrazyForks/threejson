# Solution design

## Deployment configuration

Each app receives a self-contained Cloudflare static-assets configuration modeled after `servertmp/threebox-cloud`:

- `wrangler.jsonc` points `assets.directory` at `./dist` and enables SPA fallback.
- `package.json` exposes `deploy` and `versions:upload` as build-then-Wrangler commands.
- `.gitignore` excludes local dependency folders, build output, environment secrets, test credential files, logs, and TypeScript/Vite state.
- `.assetsignore` excludes source and local development artifacts from an app artifact package. It never contains the built `dist/` folder because the deploy command publishes that folder directly.

`wrangler` is added as an app development dependency through the workspace lockfile update.

## Origin policy

The legacy host's `scenePreviewProtocol.js` owns a legacy-host origin table. React apps own their own tables in their own source trees. Both policies use the same canonical production origins, plus an explicit development table:

| Application | development origin | production origin |
| --- | --- | --- |
| editor | `http://localhost:5183` | `https://editor.threejson.org` |
| player | `http://localhost:5180` | `https://player.threejson.org` |
| shower | `http://localhost:5181` | `https://shower.threejson.org` |
| ThreeBox | `http://localhost:5182` | `https://threebox.org` |

The public `https://threejson.org` and `https://cloud.threebox.org` are also allowlisted production peers. Vite environment variables may override a specific peer endpoint for a controlled staging deployment; malformed or unallowlisted values are rejected rather than silently accepted.

## Popup handshakes

Two explicit protocol envelopes are used:

- `threejson:scene-preview` for a live player preview;
- `threejson:scene-transfer` for one-time editor imports.

Both follow the same sequence:

1. The sender opens a peer URL with `bridgeSession` and an explicit `openerOrigin` query parameter.
2. The receiver validates the declared opener origin against its own allowlist, then posts `ready` only to that origin.
3. The sender validates event origin, `event.source`, channel/version/action, and session id.
4. The sender posts `load` to the configured peer origin.
5. The receiver validates all of the same constraints, applies the payload, then sends an acknowledgement.

No `localStorage` key is used for cross-app scene delivery.

## Deferred path deployment

When the apps are ready to replace the legacy tools, same-origin path deployment can map a Vite build to `threejson.org/editor/` by building with `base: "/editor/"` and publishing the resulting `dist` directory under `editor/` in the root site's static-assets artifact. A Cloudflare Worker/Pages build pipeline can perform the copy/rewrite before deployment. This is intentionally deferred so the legacy tool remains the validation baseline.

## Verification

- Add node tests for legacy protocol allowlisting and source-policy checks.
- Build every app after adding Wrangler workspace dependencies.
- Run root `npm test`.
- Manual browser verification: open ThreeBox/Shower -> Editor and Editor/ThreeBox -> Player using the four local Vite ports; verify an unknown origin is rejected.
