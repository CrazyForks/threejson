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
 * Shell/chrome (App shell, dock/tab structure, CSS) is a faithful port of
 * tools/scene-host/editor/_shell-body.html — see src/dock/*. Feature panels are ported
 * incrementally by phase; see README.md's Scope section for current status per phase.
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
import { useDockChrome } from "./dock/useDockChrome.js";
import { TopBar } from "./dock/TopBar.jsx";
import { LeftDock } from "./dock/LeftDock.jsx";
import { RightDock } from "./dock/RightDock.jsx";
import { BottomBar } from "./dock/BottomBar.jsx";
import { ConfirmModal } from "./dock/ConfirmModal.jsx";
import { SettingsModal } from "./SettingsModal.jsx";
import { useEditorGridHelper } from "./lib/useEditorGridHelper.js";
import { useViewPreserve } from "./lib/useViewPreserve.js";
import { useUiFeedback } from "./lib/useUiFeedback.js";
import { useEditorKeyboardShortcuts } from "./lib/useEditorKeyboardShortcuts.js";
import { MeshExportDialog } from "@threejson/react-ui";
import { downloadBlob } from "@threejson/host-kit/js/meshExport.js";
import { exportSceneAsGlb, exportSelectedObjectAsGlb } from "./lib/editorMeshExport.js";
import { exportNativeSceneJson } from "./lib/editorNativeJsonExport.js";
import { exportSceneAsTjz } from "./lib/editorTjzExport.js";
import { parseTjzArchiveForScene } from "threejson/archive";

const DEFAULT_SCENE = "json/portShow.json";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

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
  const [confirmState, setConfirmState] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // Rebuild the tree whenever a scene finishes loading (editor.sceneVersion — not editor.payload,
  // see useEditorApi) or any command runs (editor.log.length): undo/redo and typed console commands
  // mutate the live graph without a scene reload, so the sceneVersion-only trigger alone would miss
  // them.
  useEffect(() => {
    setTreeRevision((n) => n + 1);
  }, [editor.sceneVersion, editor.log.length]);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [editor.log]);

  // Generic yes/no confirm, replacing native window.confirm() — see dock/ConfirmModal.jsx.
  const confirmYesNo = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      setConfirmState({
        message,
        ...options,
        resolve: (value) => {
          setConfirmState(null);
          resolve(value);
        }
      });
    });
  }, []);

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

  // Captures the object's transform just before a drag starts, so onCommit can pair it with the
  // post-drag transform into a single "transform" history entry (useEditorHistory.js) — a per-
  // object undo, not a whole-document snapshot.
  const transformBeforeRef = useRef(null);
  const { helper: gizmoHelper } = useTransformGizmo({
    player,
    object: selectedObject,
    mode: gizmoMode,
    enabled: Boolean(selectedObject),
    onDragStart: () => {
      const d = selectedObject?.userData?.objJson;
      transformBeforeRef.current = d
        ? { position: cloneJson(d.position), rotation: cloneJson(d.rotation), scale: cloneJson(d.scale) }
        : null;
    },
    onCommit: async () => {
      // syncBoxModelTransformFromObject3D already folded the live transform into the descriptor;
      // commit re-serialises so it survives a reload, then refresh the panels.
      await editor.commitRuntimeToDocument();
      const before = transformBeforeRef.current;
      const d = selectedObject?.userData?.objJson;
      if (before && d && editor.selection) {
        editor.pushHistoryEntry({
          kind: "transform",
          threeJsonId: editor.selection,
          before,
          after: { position: cloneJson(d.position), rotation: cloneJson(d.rotation), scale: cloneJson(d.scale) },
          label: "变换物体"
        });
      }
      transformBeforeRef.current = null;
      setTreeRevision((n) => n + 1);
    }
  });

  const commandHelp = useMemo(
    () => EDITOR_COMMAND_SPECS.map((s) => s.op).join("  ·  "),
    []
  );

  const dockChrome = useDockChrome();
  const { pinned, peek, setDockPeek } = dockChrome;

  const { gridVisible, axesVisible, toggleGrid, toggleAxes } = useEditorGridHelper(
    () => player.getSnapshot()?.scene || null,
    editor.sceneVersion
  );
  useViewPreserve(player, editor, sceneUrl);
  const { showMessage } = useUiFeedback();
  useEditorKeyboardShortcuts({
    onUndo: () => void editor.runCommand("editor.history.undo"),
    onRedo: () => void editor.runCommand("editor.history.redo")
  });

  // Import/export (phase 5) — file pickers driven by hidden <input type="file"> elements, matching
  // the original's #topBarOpenFileInput/#tjzArchiveFileInput pattern.
  const jsonFileInputRef = useRef(null);
  const tjzFileInputRef = useRef(null);
  const [meshExportOpen, setMeshExportOpen] = useState(false);

  const handleImportJsonFile = useCallback(
    async (file) => {
      if (!file) {
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await editor.loadPayload(data, { label: file.name });
        setSceneUrl(file.name);
        setRestoredBanner(false);
        showMessage(`已导入 ${file.name}。`, "success");
      } catch (error) {
        showMessage(`导入失败：${error?.message || error}`, "error");
      }
    },
    [editor, showMessage]
  );

  const handleImportTjzFile = useCallback(
    async (file) => {
      if (!file) {
        return;
      }
      try {
        const { payload, dispose } = await parseTjzArchiveForScene(file);
        await editor.loadPayload(payload, { label: file.name });
        setSceneUrl(file.name);
        setRestoredBanner(false);
        showMessage(`已导入 ${file.name}。`, "success");
        // The rewritten blob: URLs are consumed by the deploy pipeline as soon as loadPayload
        // resolves; dispose() only revokes them, so this is safe to call right after awaiting it.
        dispose?.();
      } catch (error) {
        showMessage(`导入失败：${error?.message || error}`, "error");
      }
    },
    [editor, showMessage]
  );

  const handleExportThreeJson = useCallback(() => {
    if (!editor.payload) {
      return;
    }
    downloadBlob(
      new Blob([JSON.stringify(editor.payload, null, 2)], { type: "application/json" }),
      `scene-${Date.now()}.json`
    );
    showMessage("ThreeJSON 已导出。", "success");
  }, [editor.payload, showMessage]);

  const handleExportNativeJson = useCallback(async () => {
    const scene = player.getSnapshot()?.scene;
    try {
      const result = await exportNativeSceneJson(scene);
      showMessage(
        result.omittedCount > 0
          ? `Three.js 原生 JSON 已导出。已跳过 ${result.omittedCount} 个过重的三方模型（${result.omittedSummary}）；完整场景请用 ThreeJSON 导出。`
          : "Three.js 原生 JSON 已导出。",
        result.omittedCount > 0 ? "warning" : "success"
      );
    } catch (error) {
      showMessage(`导出原生 JSON 失败：${error?.message || error}`, "error");
    }
  }, [player, showMessage]);

  const handleExportTjz = useCallback(async () => {
    if (!editor.payload) {
      return;
    }
    try {
      await exportSceneAsTjz(editor.payload);
      showMessage(".tjz 包已导出。", "success");
    } catch (error) {
      showMessage(`导出 .tjz 失败：${error?.message || error}`, "error");
    }
  }, [editor.payload, showMessage]);

  const handleExportGlbScene = useCallback(async () => {
    const snap = player.getSnapshot();
    if (!snap?.scene) {
      return;
    }
    try {
      const result = await exportSceneAsGlb(snap.scene, { renderer: snap.renderer, fileNameStem: "scene" });
      showMessage(
        result.warnings.length ? `已导出（含 ${result.warnings.length} 项警告）：${result.fileName}` : "GLB 已导出。",
        result.warnings.length ? "warning" : "success"
      );
    } catch (error) {
      showMessage(`导出 GLB 失败：${error?.message || error}`, "error");
    }
  }, [player, showMessage]);

  const handleExportGlbSelection = useCallback(async () => {
    const snap = player.getSnapshot();
    if (!snap?.scene || !editor.selection) {
      return;
    }
    try {
      const result = await exportSelectedObjectAsGlb(snap.scene, editor.selection, { renderer: snap.renderer });
      showMessage(
        result.warnings.length ? `已导出（含 ${result.warnings.length} 项警告）：${result.fileName}` : "GLB 已导出。",
        result.warnings.length ? "warning" : "success"
      );
    } catch (error) {
      showMessage(`导出选中对象失败：${error?.message || error}`, "error");
    }
  }, [player, editor.selection, showMessage]);

  return (
    <div id="rootContainer" className={dockChrome.rootClassName}>
      <div id="stageShell">
        <TopBar
          sceneTitle={sceneUrl}
          sceneUrl={sceneUrl}
          onSceneUrlChange={setSceneUrl}
          onLoadUrl={(url) => {
            setSceneUrl(url);
            void loadUrl();
          }}
          editor={editor}
          player={player}
          gizmoMode={gizmoMode}
          onGizmoModeChange={setGizmoMode}
          selectedObject={selectedObject}
          dockChrome={dockChrome}
          onOpenSettings={() => setSettingsOpen(true)}
          onImportJson={() => jsonFileInputRef.current?.click()}
          onImportTjz={() => tjzFileInputRef.current?.click()}
          onExportThreeJson={handleExportThreeJson}
          onExportNativeJson={() => void handleExportNativeJson()}
          onExportTjz={() => void handleExportTjz()}
          onExportGlbScene={() => void handleExportGlbScene()}
          onExportGlbSelection={() => void handleExportGlbSelection()}
          onOpenMeshExportDialog={() => setMeshExportOpen(true)}
        />
        <input
          ref={jsonFileInputRef}
          type="file"
          accept=".json,.threejson,application/json"
          hidden
          onChange={(e) => {
            void handleImportJsonFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={tjzFileInputRef}
          type="file"
          accept=".tjz,.zip,application/zip"
          hidden
          onChange={(e) => {
            void handleImportTjzFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        <main id="canvasWrap" ref={player.canvasWrapRef}>
          <canvas
            id="canvasContainer"
            ref={player.canvasRef}
            style={{ display: "block", width: "100%", height: "100%" }}
          />
          {player.loading && (
            <div id="loadingMask">
              <span className="loadingMaskInner">{player.loadingMessage || "3D 场景加载中..."}</span>
            </div>
          )}
          {!player.loading && !player.hasScene && (
            <div id="loadingMask">
              <span className="loadingMaskInner">No scene loaded.</span>
            </div>
          )}
          {restoredBanner && (
            <div className="restoredBannerNotice" style={{ display: "block" }}>
              Restored your previous session.{" "}
              <button
                className="miniBtn"
                onClick={() => {
                  void (async () => {
                    const ok = await confirmYesNo(
                      "这会丢弃恢复的会话，改为载入示例场景。是否继续？",
                      { title: "载入示例场景", confirmLabel: "载入示例", cancelLabel: "取消" }
                    );
                    if (!ok) {
                      return;
                    }
                    // Load the sample directly rather than via loadUrl(): loadUrl closes over the
                    // current sceneUrl, and setSceneUrl won't have applied yet in this same tick.
                    setSceneUrl(DEFAULT_SCENE);
                    const response = await fetch(resolveSceneHostUrl(DEFAULT_SCENE));
                    await editor.loadPayload(await response.json(), { label: DEFAULT_SCENE });
                    await recovery.clear();
                    setRestoredBanner(false);
                    showMessage("已载入示例场景。", "success");
                  })();
                }}
              >
                Load sample scene
              </button>{" "}
              <button className="miniBtn" onClick={() => setRestoredBanner(false)}>
                ×
              </button>
            </div>
          )}
          {transferMessage && (
            <div className="restoredBannerNotice" style={{ display: "block", top: "calc(46px + var(--dockInsetTop, 0px))" }} role="status">
              {transferMessage}{" "}
              <button className="miniBtn" onClick={() => setTransferMessage("")}>
                ×
              </button>
            </div>
          )}
          <div id="messageBox" />
        </main>

        <LeftDock
          pinned={pinned.leftDock}
          onTogglePin={() => dockChrome.togglePinned("leftDock")}
          onMouseEnter={() => setDockPeek("leftDock", true)}
          onMouseLeave={() => setDockPeek("leftDock", false)}
        />

        <RightDock
          pinned={pinned.rightDock}
          onTogglePin={() => dockChrome.togglePinned("rightDock")}
          onMouseEnter={() => setDockPeek("rightDock", true)}
          onMouseLeave={() => setDockPeek("rightDock", false)}
        >
          <div className="panelCard sceneTreeCard">
            <div className="panelTitle">场景树</div>
            {/* During a reload the runtime has no scene yet, and the panel's empty state ("no
                objects in this scene") would read as data loss rather than as work in progress. */}
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
          </div>

          <PropertyInspector
            editor={editor}
            selection={editor.selection}
            // Refetch after a scene reload (undo/redo/ingest) or any command the console ran.
            revision={`${editor.sceneVersion}:${editor.log.length}`}
            // A patch mutates the graph in place; tell the tree to rebuild so a rename or a
            // visibility change is reflected there too.
            onChanged={() => setTreeRevision((n) => n + 1)}
          />

          {/* Command console: a dev affordance this app adds beyond the original chrome, so every
              editor.* command is reachable without a UI for it yet. Not part of _shell-body.html. */}
          <div className="panelCard">
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
                className="editorThemedField"
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
                className="toolBtn"
                onClick={() => {
                  void editor.runCommand(commandLine);
                  setCommandLine("");
                }}
                disabled={!commandLine.trim()}
              >
                Run
              </button>
              <button className="toolBtn secondary" onClick={editor.clearLog}>
                Clear
              </button>
            </div>
          </div>
        </RightDock>
      </div>

      <BottomBar
        gizmoVisible={gizmoVisible}
        onToggleGizmo={toggleGizmo}
        gridVisible={gridVisible}
        onToggleGrid={toggleGrid}
        axesVisible={axesVisible}
        onToggleAxes={toggleAxes}
      />
      <ConfirmModal
        state={confirmState}
        onCancel={() => confirmState?.resolve(false)}
        onConfirm={() => confirmState?.resolve(true)}
      />
      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} showToast={showMessage} />
      )}
      {meshExportOpen && (
        <MeshExportDialog
          getSceneSnapshot={() => {
            const snap = player.getSnapshot();
            return snap?.scene ? { scene: snap.scene, renderer: snap.renderer, currentLabel: "scene" } : null;
          }}
          onClose={() => setMeshExportOpen(false)}
          onExported={(detail) => {
            showMessage(
              detail.warnings?.length ? `已导出（含 ${detail.warnings.length} 项警告）：${detail.fileName}` : "已导出。",
              detail.warnings?.length ? "warning" : "success"
            );
          }}
        />
      )}
    </div>
  );
}
