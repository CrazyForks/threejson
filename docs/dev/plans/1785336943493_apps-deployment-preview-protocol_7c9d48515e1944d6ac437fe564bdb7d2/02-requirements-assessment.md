# Requirements assessment

## Scope

1. Tighten the root deployment allowlist/ignore rules while preserving all current runtime dependencies (`assets/`, `tools/`, `core/`, `builtins/`, `domains/`, `extensions/`, `website/`, `docs/en/`, `docs/zh/`).
2. Make each React app independently deployable with its own `.gitignore`, `.assetsignore`, `wrangler.jsonc`, and package scripts.
3. Make message origin selection explicit; no protocol may silently use `window.location.origin` as the target origin.
4. Provide a verified `window.open()` + readiness handshake for app scene transfer:
   - ThreeBox -> scene editor;
   - scene shower -> scene editor;
   - scene editor -> scene player preview;
   - ThreeBox -> scene player preview.

## Security and correctness requirements

- Every receiving listener verifies the protocol envelope, the known peer origin, the popup/opener window identity, and a one-time session id.
- Every sender targets a configured peer origin, never `"*"` and never an implicit current origin default.
- Development origins are an explicit fixed table and can be overridden by Vite environment variables; they are not inferred from the current URL.
- Scene payloads remain in browser memory and are released after the one-time handoff.
- A popup block or handshake timeout must fail visibly but safely.

## Risks

- Vite apps are standalone workspaces. Importing a shared source file across `apps/*` would violate standalone-app constraints.
- Cloudflare worker names and custom-domain bindings are account-specific. Configurations will expose deploy scripts and static SPA settings but will not hard-code routes/DNS bindings.
- The legacy `tools/scene-host` still has established same-origin behavior. Its compatible protocol change must preserve its current local relative URL flow while making cross-origin peers explicit.

## Acceptance criteria

- Root `.assetsignore` excludes deployment-irrelevant and potentially sensitive directories specified in the deployment document.
- All four apps contain `.gitignore`, `.assetsignore`, and `wrangler.jsonc`, and have `deploy`/`versions:upload` scripts.
- Production and explicit local development peer origin tables are present in the legacy host and in each relevant app.
- No app imports a `tools/scene-host` file.
- The legacy protocol and React app handoff functions reject unknown origins and missing/mismatched sessions.
- Root tests and all app builds pass after dependencies are installed.
