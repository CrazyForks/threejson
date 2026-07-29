# @threejson/editor-kit

Framework-agnostic, **no-shell** logic for building ThreeJSON scene editors — the parts of an
editor that are pure logic, not UI:

- **Command layer** (`@threejson/editor-kit/command`): the editor command registry, `EDITOR_COMMAND_SPECS`,
  and the `exec` / `selection` / `view` / `history` / `ingest` / `agent` command handlers.
- **AI update flow** (`@threejson/editor-kit/ai`): `runEditorAiUpdate` and the prompt/context builders
  for the command-based and whole-JSON scene-update round-trips.
- **Domain-edit session** (`@threejson/editor-kit/domainEditSession`): drill-in, child-transform
  baselines, degrade/undo, and settings resolution for editing deployed business-domain objects.

No DOM, no UI framework. Scene tree, property panels, sidebars, the code editor, and the app shell
stay in the consuming application.

Extracted from [`tools/scene-host/editor/lib`](../../tools/scene-host/editor/lib), which stays the
stable production baseline and is **not** yet changed to depend on this package.

## Install

```bash
npm install @threejson/editor-kit threejson three
```

`threejson` and `three` are peer dependencies.

## Usage

```js
import { registerEditorCommands, EDITOR_COMMAND_SPECS } from "@threejson/editor-kit/command";
import { runEditorAiUpdate } from "@threejson/editor-kit/ai";
import { resolveDomainDeployRoot } from "@threejson/editor-kit/domainEditSession";
```

## Depends on `threejson/edit`

Building an editor needs engine internals a plain scene *consumer* never touches — domain-edit
state machinery, AI command-batch inspection, WYSIWYG export helpers. Those are **not** on the main
`threejson`/`threejson/core` runtime surface; they live on a dedicated
[`threejson/edit`](../../core/edit.js) subpath (a capability-scoped path, not named after any host)
so they stay semantically separated from the core runtime API (and carry a narrower stability
contract). editor-kit imports the general command/AI/util symbols from `threejson/core` and the
edit-time ones from `threejson/edit`.

## Status

Alpha. This is the "second batch" of the packages extraction: the command / AI / domain-edit-session
core only. Other editor logic with UI-coupled dependency tails (history-with-material-sync,
document-ops-with-session-capture) is not yet extracted. Consumed by `apps/scene-editor`, which
supplies the `EditorApi` seam (`src/useEditorApi.js`) this command layer is written against.
`tools/scene-host/editor` deliberately stays on its own copy — it is both the production baseline
and the reference the app is written against — until the app can replace it outright.
