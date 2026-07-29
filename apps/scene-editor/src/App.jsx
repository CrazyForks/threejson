/**
 * ThreeJSON Scene Editor — React app built entirely on the published @threejson/* packages. Every
 * import is a bare package specifier: no relative path into the monorepo, no dependency on
 * tools/scene-host.
 *
 *   @threejson/editor-kit → the editor command layer (registry + editor.* command surface)
 *   @threejson/react      → useScenePlayer (viewport)
 *   @threejson/react-ui   → SceneTreePanel (hierarchical outliner, shared with other apps)
 *   @threejson/host-kit   → scene URL resolution, scene-tree model, live-object lookup
 *   threejson             → command registry/executor, engine
 *
 * Scope: load a scene, browse its object hierarchy, select via tree/inspector/gizmo, and drive the
 * editor through editor-kit's command layer. Not reimplemented from the original ~16,000-line editor:
 * material/texture panels, three-view, AI sidebars, CodeMirror, session recovery — see README.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScenePlayer } from "@threejson/react";
import { SceneTreePanel } from "@threejson/react-ui";
import { resolveSceneHostUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { findObjectInScene } from "@threejson/host-kit/js/sceneTreeModel.js";
import { EDITOR_COMMAND_SPECS } from "@threejson/editor-kit/command";
import { useEditorApi } from "./useEditorApi.js";
import { PropertyInspector } from "./PropertyInspector.jsx";
import { useTransformGizmo } from "./useTransformGizmo.js";
import { useViewportGizmo } from "./useViewportGizmo.js";
import { useSessionRecovery } from "./useSessionRecovery.js";
import {
  createSceneEditorTransferReceiver,
  hasSceneTransferRequest
} from "./sceneTransferProtocol.js";

const DEFAULT_SCENE = "json/portShow.json";

export function App() {
  const player = useScenePlayer();
  const editor = useEditorApi(player);
  // The scene graph is mutated in place, which React cannot observe — bump this to tell the tree
  // panel to rebuild after a load or an edit.
  const [treeRevision, setTreeRevision] = useState(0);
  const [commandLine, setCommandLine] = useState("");
  const [gizmoMode, setGizmoMode] = useState("translate");
  // Navigation-gizmo visibility, persisted so the choice survives a refresh (matches the original
  // shower's showViewGizmo checkbox). Defaults on.
  const [gizmoVisible, setGizmoVisible] = useState(
    () => localStorage.getItem("threejson.editor.navGizmo") !== "off"
  );
  const [sceneUrl, setSceneUrl] = useState(DEFAULT_SCENE);
  const [restoredBanner, setRestoredBanner] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const consoleEndRef = useRef(null);
  const autoLoadedRef = useRef(false);
  const transferReceiverRef = useRef(null);
  const hasExternalTransferRef = useRef(hasSceneTransferRequest());
  const recovery = useSessionRecovery();
  // Gate persistence until the boot decision (restore vs. default) has run — otherwise the default
  // scene's auto-load would immediately overwrite the very snapshot we are about to restore.
  const bootDoneRef = useRef(false);

  // Auto-load once per runtime instance (see apps/scene-player for the StrictMode reasoning). Wait
  // for recovery to finish reading IndexedDB so the boot can choose restore-vs-default with the
  // answer in hand rather than racing it.
  useEffect(() => {
    if (!player.ready || !recovery.ready) {
      autoLoadedRef.current = false;
      return;
    }
    if (autoLoadedRef.current) {
      return;
    }
    autoLoadedRef.current = true;
    void (async () => {
      if (hasExternalTransferRef.current) {
        // A verified popup handoff owns boot for this document. Do not race it with recovery/default
        // loading, otherwise a late restore could overwrite a scene that just arrived.
        bootDoneRef.current = true;
        return;
      }
      if (recovery.saved?.payload) {
        await editor.loadPayload(recovery.saved.payload, { label: recovery.saved.label || "restored session" });
        if (recovery.saved.selection) {
          await editor.runCommand(`editor.selection.set id=${recovery.saved.selection}`);
        }
        setRestoredBanner(true);
      } else {
        const response = await fetch(resolveSceneHostUrl(DEFAULT_SCENE));
        const data = await response.json();
        await editor.loadPayload(data, { label: DEFAULT_SCENE });
      }
      bootDoneRef.current = true;
    })();
  }, [player.ready, recovery.ready, recovery.saved, editor]);

  useEffect(() => {
    if (!player.ready || !hasExternalTransferRef.current || transferReceiverRef.current) {
      return;
    }
    const receiver = createSceneEditorTransferReceiver({
      applyPayload: async (payload, context) => {
        const label = String(context?.label || "external scene transfer");
        await editor.loadPayload(payload, { label });
        setSceneUrl(label);
        setRestoredBanner(false);
        bootDoneRef.current = true;
      },
      onStatus: (status, detail) => {
        if (status === "waiting") {
          setTransferMessage("Waiting for a scene from the opening application…");
        } else if (status === "loaded") {
          setTransferMessage(`Loaded transferred scene${detail ? `: ${detail}` : "."}`);
        } else {
          setTransferMessage(`Scene transfer failed: ${detail || "unknown error"}`);
        }
      }
    });
    transferReceiverRef.current = receiver;
    receiver.bootstrap();
    return () => {
      receiver.dispose?.();
      if (transferReceiverRef.current === receiver) {
        transferReceiverRef.current = null;
      }
    };
  }, [player.ready, editor]);

  // Persist the committed document + selection after every edit, once boot has settled.
  useEffect(() => {
    if (!bootDoneRef.current || !editor.payload) {
      return;
    }
    recovery.save({ payload: editor.payload, selection: editor.selection, label: sceneUrl });
  }, [editor.sceneVersion, editor.selection, editor.payload, sceneUrl, recovery]);

  // Rebuild the tree whenever a scene finishes loading. editor.sceneVersion (not editor.payload) is
  // the correct trigger — see useEditorApi.
  useEffect(() => {
    setTreeRevision((n) => n + 1);
  }, [editor.sceneVersion]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [editor.log]);

  const loadUrl = useCallback(async () => {
    const url = sceneUrl.trim();
    if (!url) {
      return;
    }
    const response = await fetch(resolveSceneHostUrl(url));
    const data = await response.json();
    await editor.loadPayload(data, { label: url });
    setRestoredBanner(false);
  }, [sceneUrl, editor]);

  const selectNode = useCallback(
    (node) => {
      // The tree lists every authored object, but only those carrying a threeJsonId are addressable
      // by the command layer — nested mesh parts of an imported model are not.
      const id = node.threeJsonId;
      if (!id) {
        return;
      }
      // Routed through the command layer rather than setState, so selecting in the UI and
      // `editor.selection.set` from the console follow exactly the same path.
      // Core's micro-DSL is `key=value` with no leading dashes — the key is taken literally, so
      // `--id=x` would arrive as args["--id"] and the handler's args.id would be undefined.
      void editor.runCommand(`editor.selection.set id=${id}`);
    },
    [editor]
  );

  // The gizmo attaches to a live Object3D, so resolve the selected threeJsonId against the current
  // scene. Re-resolve on sceneVersion too: a reload rebuilds the graph, so a cached object would be
  // a detached orphan from the previous scene.
  const selectedObject = useMemo(() => {
    if (!editor.selection) {
      return null;
    }
    return findObjectInScene(player.getSnapshot()?.scene || null, { threeJsonId: editor.selection });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.selection, editor.sceneVersion, player]);

  // Corner navigation gizmo: click a face/axis to snap the camera to that orthographic view.
  // `enabled: false` disposes it — the component's own show/hide parameter, driven here by the toggle.
  useViewportGizmo({
    player,
    containerRef: player.canvasWrapRef,
    sceneVersion: editor.sceneVersion,
    enabled: gizmoVisible
  });

  const toggleGizmo = useCallback(() => {
    setGizmoVisible((prev) => {
      const next = !prev;
      localStorage.setItem("threejson.editor.navGizmo", next ? "on" : "off");
      return next;
    });
  }, []);

  const { helper: gizmoHelper } = useTransformGizmo({
    player,
    object: selectedObject,
    mode: gizmoMode,
    enabled: Boolean(selectedObject),
    onDragStart: () => editor.beginHistoryStep(),
    onCommit: async () => {
      // syncBoxModelTransformFromObject3D already folded the live transform into the descriptor;
      // commit re-serialises so it survives a reload, then refresh the panels.
      await editor.commitRuntimeToDocument();
      setTreeRevision((n) => n + 1);
    }
  });

  const commandHelp = useMemo(
    () => EDITOR_COMMAND_SPECS.map((s) => s.op).join("  ·  "),
    []
  );

  return (
    <div className="app">
      <div className="bar">
        <span className="brand">ThreeJSON Editor</span>
        <input
          value={sceneUrl}
          onChange={(e) => setSceneUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void loadUrl()}
          style={{
            background: "#0e1319",
            color: "inherit",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "5px 8px",
            minWidth: 260,
            font: "inherit"
          }}
        />
        <button onClick={() => void loadUrl()}>Load</button>
        <span className="spacer" />
        <div className="gizmoModes" role="group" aria-label="Transform mode">
          {["translate", "rotate", "scale"].map((m) => (
            <button
              key={m}
              className={gizmoMode === m ? "active" : ""}
              disabled={!selectedObject}
              title={selectedObject ? `${m[0].toUpperCase()}${m.slice(1)} the selected object` : "Select an object first"}
              onClick={() => setGizmoMode(m)}
            >
              {m === "translate" ? "Move" : m === "rotate" ? "Rotate" : "Scale"}
            </button>
          ))}
        </div>
        <button onClick={() => void editor.runCommand("editor.view.fit")} disabled={!player.hasScene}>
          Fit view
        </button>
        <button
          className={gizmoVisible ? "active" : ""}
          title="Show/hide the navigation gizmo"
          aria-pressed={gizmoVisible}
          onClick={toggleGizmo}
        >
          Gizmo
        </button>
        <button onClick={() => void editor.runCommand("editor.history.undo")}>Undo</button>
        <button onClick={() => void editor.runCommand("editor.history.redo")}>Redo</button>
      </div>

      {restoredBanner && (
        <div className="recoveryBanner">
          <span>Restored your previous session. Edits keep autosaving.</span>
          <span className="spacer" />
          <button
            onClick={() => {
              // Load the sample directly rather than via loadUrl(): loadUrl closes over the current
              // sceneUrl, and setSceneUrl won't have applied yet in this same tick.
              void (async () => {
                setSceneUrl(DEFAULT_SCENE);
                const response = await fetch(resolveSceneHostUrl(DEFAULT_SCENE));
                await editor.loadPayload(await response.json(), { label: DEFAULT_SCENE });
                await recovery.clear();
                setRestoredBanner(false);
              })();
            }}
          >
            Load sample scene
          </button>
          <span className="spacer" />
          <button className="recoveryClose" aria-label="Dismiss" onClick={() => setRestoredBanner(false)}>
            ×
          </button>
        </div>
      )}

      {transferMessage && (
        <div className="recoveryBanner" role="status">
          <span>{transferMessage}</span>
          <span className="spacer" />
          <button className="recoveryClose" aria-label="Dismiss transfer status" onClick={() => setTransferMessage("")}>
            ×
          </button>
        </div>
      )}

      <div className="body">
        <aside className="panel left">
          <div className="panelTitle">Scene tree</div>
          {/* During a reload the runtime has no scene yet, and the panel's empty state ("no objects
              in this scene") would read as data loss rather than as work in progress. */}
          {player.loading ? (
            <div className="hint">{player.loadingMessage || "Loading…"}</div>
          ) : (
          <SceneTreePanel
            scene={player.getSnapshot()?.scene || null}
            revision={treeRevision}
            selectedKey={editor.selection}
            onSelect={selectNode}
            // The gizmo helper is a live child of the scene; keep it out of the outliner.
            extraRuntimeObjects={gizmoHelper ? [gizmoHelper] : undefined}
          />
          )}
        </aside>

        <div className="viewportWrap" ref={player.canvasWrapRef}>
          <canvas ref={player.canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
          {player.loading && <div className="mask">{player.loadingMessage || "Loading…"}</div>}
          {!player.loading && !player.hasScene && <div className="mask">No scene loaded.</div>}
        </div>

        <aside className="panel right">
          <div className="panelTitle">Properties</div>
          <PropertyInspector
            editor={editor}
            selection={editor.selection}
            // Refetch after a scene reload (undo/redo/ingest) or any command the console ran.
            revision={`${editor.sceneVersion}:${editor.log.length}`}
            // A patch mutates the graph in place; tell the tree to rebuild so a rename or a
            // visibility change is reflected there too.
            onChanged={() => setTreeRevision((n) => n + 1)}
          />

          <div className="panelTitle">
            Command console
            <div className="muted" style={{ fontWeight: 400, fontSize: 11, marginTop: 2 }}>
              selection: {editor.selection || "—"}
            </div>
          </div>

          <div className="console">
            <div className="line muted">Available: {commandHelp}</div>
            {editor.log.map((entry, i) => (
              <div key={i} className={`line ${entry.kind}`}>
                {entry.kind === "in" ? "› " : ""}
                {entry.text}
              </div>
            ))}
            <div ref={consoleEndRef} />
          </div>

          <div className="consoleBar">
            <input
              value={commandLine}
              placeholder="editor.view.fit"
              onChange={(e) => setCommandLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void editor.runCommand(commandLine);
                  setCommandLine("");
                }
              }}
            />
            <button
              className="primary"
              onClick={() => {
                void editor.runCommand(commandLine);
                setCommandLine("");
              }}
              disabled={!commandLine.trim()}
            >
              Run
            </button>
            <button onClick={editor.clearLog}>Clear</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
