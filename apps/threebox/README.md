# apps/threebox

ThreeBox's AI scene workbench as a React application, built **entirely on the published
`@threejson/*` packages** — no relative import into the monorepo, no dependency on
`tools/scene-host` or the other apps.

```
@threejson/host-kit → AI turn orchestration, built-in trial provider, privacy gate, error feedback,
                      session store (conversations / turns / resources)
@threejson/react    → useScenePlayer, useHostI18n, useConversations (persisted history)
@threejson/react-ui → MeshExportDialog (the scene card's model-export action)
threejson           → envelope building + .tjz packaging (direct imports); the engine (transitive)
```

## Run

```bash
npm run dev      # http://localhost:5182
npm run build
```

## Optional: point the dev server at a real AI provider

The generate / adjust / Agent loops can only be exercised end to end against a live model. For local
development you can drop your own key into a gitignored file instead of retyping it into the
settings panel on every reload:

```bash
cp settings.test.json.example settings.test.json
# then edit settings.test.json and fill in "apiKey"
```

```jsonc
{
  "provider": "deepseek",   // deepseek | chatgpt | custom
  "apiKey": "sk-...",       // use a throwaway/test key
  "model": "",              // blank = provider default
  "baseUrl": ""             // only for provider=custom / self-hosted OpenAI-compatible root
}
```

The dev server then offers that provider to the app automatically (it appears in the composer's
model picker as `Dev · <provider> (settings.test.json)`).

**This is a development-only channel, and it is safe by construction:**

- `settings.test.json` is gitignored (`apps/*/settings.test.json`) — **never commit a real key**.
  Only the `.example` template is tracked.
- The key is served by a Vite `configureServer` middleware at request time, so it is **read from
  disk only by the running dev server and never bundled into any build artifact** — the
  `/__ai-test-settings` endpoint does not exist in `npm run build` output.
- Provider APIs reject browser-origin calls (CORS), so the dev server also proxies `/ai-test-proxy`
  to the provider — again dev-only.
- The whole thing degrades gracefully: with no `settings.test.json`, `npm run dev` works exactly as
  before and you simply configure a provider in the settings panel by hand.

See `vite.config.js` for the implementation.

## Scope — read this before comparing to tools/scene-host/threebox

The original `tools/scene-host/threebox` is ~6,200 lines of product shell across 26 app-local
modules; **none of that product logic lived in a `@threejson/*` package** — only the shared
AI/i18n/upload/path layer was in host-kit. This app started as a "step one" generate-loop proof and
has since had most of that shell rebuilt on the published packages.

That shell has since been rebuilt here on the published packages, reproducing the original's DOM and
reusing its `threebox.css` verbatim. **Reimplemented here:**

- Generate loop + **adjust** turns (commands / JSON-patch / full-JSON fallback chain)
- **Agent mode** — multi-round `agentOptions` + live progress, with progressive draft previews
  rendered into the card as the agent refines
- Conversation history + IndexedDB persistence (`useConversations`), projects, archive,
  cross-conversation search
- Per-message scene cards, each owning a **live** Three.js canvas; **JSON**, **.tjz**, and **model**
  (mesh) export; collapsible scene-JSON and adjust-diff views
- Composer attachments (upload / drag-drop) and the attached-scene context row, consumed as a seed
  turn on send
- Template gallery with lazily-captured live thumbnails, and the resource library
- The full schema-driven settings model (`threeBoxSettingsSchema`/`Store`) — nav + sections +
  provider cards, driving real behavior (adjust output mode, JSON viewer, prompt prefix, titles,
  recaps, …)
- Built-in provider quota, built-in notifications, self-hosted sync, and cloud migration

Where a capability had no `@threejson/*` home, it lives app-local under `src/lib/` (ported from the
original module of the same name) rather than being dropped — see each file's docblock.

## The built-in provider is gated on purpose

Prompts sent through ThreeBox's built-in trial backend are content-moderated server-side and tied to
an anonymous per-device identifier for quota and abuse enforcement. The app therefore blocks any
generate call until the user has explicitly accepted that notice (persisted by host-kit's
`builtinProviderPrivacy`). Declining is fully supported: the user configures their own
OpenAI-compatible provider instead, whose traffic never touches ThreeBox's moderation pipeline or
device identifier. A user-supplied API key is stored in that browser's `localStorage` only and is
sent solely to the endpoint they configure.

## Verified behavior

Pressing **Send** with no consent decision on record shows the privacy notice *before* any network
call — no prompt is transmitted (`messages sent: 0`), the typed prompt is preserved, and the device
identifier computed by host-kit (e.g. `TB-136CAABF6A`) is shown so the user can quote it in a
report. Declining persists `declined` to host-kit's scoped key
(`threejson.builtin-provider-privacy.v1.threebox`) and opens Settings, where the own-provider form
exposes provider type / API key (masked) / optional model.

An end-to-end generation was **not** exercised in automated verification, since that would send data
to the live ThreeBox backend and consume trial quota.


## Conversation history

Chat history persists in IndexedDB via `useConversations` (@threejson/react over host-kit's
`threeBoxSessionStore`). Each turn stores its own scene snapshot, so reopening a conversation
replays its transcript **and** re-renders its most recent scene without calling the model again.
Failed turns are recorded too, so a reopened conversation shows what actually happened instead of
silently dropping the exchange.

Deleting a conversation removes its turns as well — verified against the database, not just the UI.
Archived conversations stay stored but are filtered out of the list.

Verified by seeding the database directly and reloading: the sidebar listed the conversation
(archived one correctly hidden), opening it replayed a 4-message transcript in order — including the
failed turn as an error bubble — and rendered the stored 1,016-char scene into the viewport. "New
chat" cleared the transcript and deselected without touching the list; deleting left 0 orphaned
turns.


## Per-message scene cards

Every assistant message that produced a scene carries a card: **Show** (render it in the viewport),
**JSON** (download it, pretty-printed), **.tjz** (download a scene *package* — a zip of the scene
JSON plus its assets, via `threejson`'s `packJsonSceneArchive`), **Model** (export
GLB/GLTF/OBJ/STL/PLY/USDZ via `@threejson/react-ui`'s `MeshExportDialog`).

The `.tjz` action produces exactly what the original card did — verified in-browser to emit a real
zip (`PK` magic, `application/zip`) named from the scene, containing `scene.json` +
`manifest.json`; `tests/hostKitSmoke.test.mjs` round-trips the archive back through the engine's
parser to confirm it is loadable, not merely a valid empty zip.

Like the original (`threeBoxSceneCard.js`), each card renders a **live** Three.js canvas of its own
via `createJsonScene({ canvas })` — there is no shared viewport. Scene loads are serialized through
a queue so concurrent cards never race on one canvas, and `src/useSceneCard.js` disposes each
runtime on unmount.

Because each card owns a real WebGL context, the app is **not** wrapped in `<StrictMode>`: its
dev-only double-invoke (setup → cleanup → setup on the same canvas node) tears down a context that
cannot be recreated on the reused canvas, leaving the card stuck on its loading mask. See
`src/main.jsx`.

Mesh export works off the **live** scene, so a card's Model action loads that card's scene into the
viewport first — exporting whatever happened to be displayed would silently produce the wrong model.
Verified: with the sphere scene displayed, the first card's Model action produced
`minimal-scene-friendly-json.glb` (2,408 bytes) — the filename proves the export followed the card,
not the viewport.

Cards work entirely off each turn's stored `sceneJson`, so they keep working for a conversation
reopened from IndexedDB long after the model call that produced it.


## Adjust turns

Once a scene is on screen the composer offers **Adjust this scene** (default) or **New scene**. An
adjust edits the scene the viewport is currently showing — including one replayed from history —
and records `targetTurnId` on the stored turn, so a reopened conversation still says what was
adjusted.

The orchestrator never mutates a live scene: every path returns a *new* `sceneJson` for the caller
to apply. So an adjust is "generate a successor from this scene", not an in-place edit, which is why
each adjust produces its own card and its own undoable history entry.

`runAiAdjustTurn` cascades internally — scene commands, then an RFC 6902 JSON-Patch, then a full
regeneration — and reports which one landed as `stage`. The assistant message surfaces it
("Scene adjusted (commands)") because a targeted command edit and a wholesale regeneration are very
different things to have happened to a user's scene.

**Verification status:** the UI, the target tracking, and the request construction are verified —
the mode row appears only when a scene is present, defaults to adjust, an explicit "New scene"
override sticks, "New chat" clears it, and `tests/hostKitSmoke.test.mjs` pins the envelope's intent
and the bounded context payload. The **model round-trip itself is not verified here**: it needs a
live provider (the built-in one is behind a privacy gate and a key), so the cascade's behaviour
against a real model has not been exercised in this repo.


## Templates & Library (left dock sections)

**Templates** are starter scenes from ThreeBox's manifest on the `@threejson/assets` CDN
(`{ items: [{ id, title, titleEn, json }] }`). Like the original, each card shows a real captured
thumbnail: `src/lib/threeBoxTemplateThumbnails.js` renders the scene once on a single shared
offscreen canvas, caches the JPEG data URL in `localStorage` (3-day TTL), and spreads a capture
burst across idle windows — so it is one reused context, not one per card. Cards start on the
placeholder logo and lazily capture when scrolled into view (`IntersectionObserver`); Settings ›
General offers rebuild/clear of that cache.

Picking a template **attaches** it to the composer's context row (see below) rather than loading it
as the current chat — matching the original, where the attached scene becomes a seed turn on the
next send so your message adjusts it.

**Library** lists saved scenes from host-kit's `threeBoxSessionStore` (the `resources` store,
already used by the session history). **Save current scene** persists the shown scene as a `json`
resource; clicking one reloads it; × deletes it. `apps/threebox/src/useResources.js` is the binding
— kept app-local rather than in `@threejson/react` because resources have a single consumer, the
same rule that keeps the property inspector out of the packages.

**Verified**: the Templates tab loaded 5 manifest entries and picking one rendered it; Save wrote a
`kind:"json"` resource to IndexedDB (verified in the DB, not just the list); a 61.9 KB port scene
saved and reloaded from the Library rendered cleanly (its size distinguishing it from the 1 KB cube
that was displayed at load time), and delete removed the row and the DB record. Pixel-diffing the
canvas was not usable here (the preview's WebGL buffer clears after compositing), so scene identity
was checked by resource size and clean-render state instead.
