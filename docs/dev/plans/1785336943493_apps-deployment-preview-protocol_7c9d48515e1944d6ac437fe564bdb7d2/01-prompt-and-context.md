# Prompt and context

## Request

Prepare the React applications under `apps/*` for independent Cloudflare static deployments without replacing the existing `tools/scene-host` products yet. The requested first phase covers:

- deployment-scoped ignore rules;
- per-app Git and Cloudflare artifact ignore rules;
- Cloudflare deployment scripts following `servertmp/threebox-cloud` as a reference;
- explicit, allowlisted cross-origin `postMessage` protocols;
- replacing app-side scene handoff through shared `localStorage` assumptions with a popup handshake;
- documenting, but not yet implementing, later same-origin path deployment or product/domain retirement.

## Maintainer decisions recorded in the request

- `apps/*` will eventually replace `tools/scene-host`, but the old host remains the deployment-validation baseline for this phase.
- Do not execute the document's second or third deployment stage now.
- Do not split `community.threebox.org` now. The eventual open-source/community versus commercial ThreeBox distinction is a separate product decision.
- Cross-origin peers that may communicate in production are `threejson.org`, `threebox.org`, `cloud.threebox.org`, `editor.threejson.org`, `player.threejson.org`, and `shower.threejson.org`.
- Apps must not import `tools/scene-host/shared/js/scenePreviewProtocol.js`; the old host and the React apps maintain independently configured origin policy.

## Repository constraints

- Preserve one-way dependency rules: apps may only use their own relative files and published/bare package imports.
- Do not modify `servertmp/*`; it is a deployment reference only.
- Do not deploy or publish packages in this change.
- Keep browser-to-browser scene handoff local: no server relay and no scene persistence as an incidental side effect.

## Review

- Reviewer: project maintainer (user)
- Date: 2026-07-29
- Result: approved in conversation, subject to implementation and verification below.
