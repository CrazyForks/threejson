/**
 * ThreeJSON Scene Player — React app built entirely on the published @threejson/* packages.
 *
 * Every import is a bare package specifier: this app has no relative path into the ThreeJSON
 * monorepo and no dependency on tools/scene-host.
 *
 *   @threejson/react      → useScenePlayer / usePlaylist / useHostI18n / usePlayerSettings
 *   @threejson/player-kit → scene-file classification (playlist model reached via usePlaylist)
 *   @threejson/host-kit   → settings-derived default scene URL, relative-URL resolution
 *   threejson             → the engine, transitively
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useScenePlayer,
  useHostI18n,
  usePlayerSettings,
  usePlaylist
} from "@threejson/react";
import { isSupportedSceneFileName } from "@threejson/player-kit/js/createPlayerRuntime.js";
import { getDefaultSceneUrl } from "@threejson/host-kit/js/playerSettingsStore.js";
import { resolveSceneHostUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { MeshExportDialog } from "@threejson/react-ui";
import { SettingsDialog } from "./SettingsDialog.jsx";
import { createScenePlayerPreviewReceiver } from "./scenePreviewProtocol.js";

export function App() {
  const { locale, t, setLocale } = useHostI18n();
  const settingsApi = usePlayerSettings();
  const { settings, loading: settingsLoading } = settingsApi;
  const player = useScenePlayer();

  const fileInputRef = useRef(null);
  const nativeInputRef = useRef(null);
  const [urlInput, setUrlInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showMeshExport, setShowMeshExport] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [menuEntry, setMenuEntry] = useState(null);
  const seededRef = useRef(false);

  // This app owns its own cross-origin preview protocol rather than depending on the legacy
  // scene-host bridge. A popup may only load a scene after the explicit origin/session handshake.
  const previewBridgeRef = useRef(null);
  const [previewActive, setPreviewActive] = useState(false);
  useEffect(() => {
    if (!player.ready || previewBridgeRef.current) {
      return;
    }
    const bridge = createScenePlayerPreviewReceiver({
      applyPayload: (payload, ctx) =>
        player.loadFromPayload(payload, { label: ctx?.label, bindSceneEvents: ctx?.bindSceneEvents })
    });
    previewBridgeRef.current = bridge;
    if (bridge.bootstrap()) {
      seededRef.current = true;
      setPreviewActive(true);
    }
    return () => {
      bridge.dispose?.();
      if (previewBridgeRef.current === bridge) {
        previewBridgeRef.current = null;
      }
    };
  }, [player.ready, player]);

  // Playing an entry is the app's job; the playlist only moves its pointer (see createPlaylistStore).
  const playEntry = useCallback(
    async (entry) => {
      if (!entry) {
        return;
      }
      if (entry.kind === "file" && entry.file) {
        await player.loadFromFile(entry.file, { label: entry.label });
      } else if (entry.url) {
        await player.loadFromUrl(entry.url, { label: entry.label });
      }
    },
    [player]
  );

  const playlist = usePlaylist({
    storagePrefix: "threejson.apps.scenePlayer.playlist",
    resolveUrl: resolveSceneHostUrl,
    onActivate: playEntry
  });

  // Seed the settings-derived default scene, but only when nothing was restored from storage —
  // otherwise a returning user's saved playlist would be overwritten on every visit.
  useEffect(() => {
    if (!player.ready || settingsLoading || !settings || seededRef.current) {
      return;
    }
    // Give the playlist's own restore a chance to land first.
    const timer = setTimeout(() => {
      if (seededRef.current || playlist.entries.length > 0) {
        seededRef.current = true;
        return;
      }
      seededRef.current = true;
      const url = getDefaultSceneUrl(settings);
      const index = playlist.addUrl(url);
      void playlist.activate(index);
    }, 250);
    return () => clearTimeout(timer);
  }, [player.ready, settingsLoading, settings, playlist]);

  const onPickFiles = useCallback(
    async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      const supported = files.filter((f) => isSupportedSceneFileName(f.name));
      if (!supported.length) {
        window.alert(t("player.message.pickSceneFile", "Please choose a JSON or .tjz scene file."));
        return;
      }
      let firstIndex = -1;
      for (const file of supported) {
        const index = await playlist.addFile(file);
        if (firstIndex < 0) {
          firstIndex = index;
        }
      }
      if (firstIndex >= 0) {
        await playlist.activate(firstIndex);
      }
    },
    [playlist, t]
  );

  const onAddUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) {
      return;
    }
    setUrlInput("");
    const index = playlist.addUrl(url);
    await playlist.activate(index);
  }, [playlist, urlInput]);

  const onRemove = useCallback(
    async (index) => {
      setMenuEntry(null);
      const { removedCurrent, nextIndex } = await playlist.removeAt(index);
      if (removedCurrent && nextIndex < 0) {
        player.stop();
      }
    },
    [playlist, player]
  );

  const onClearPlaylist = useCallback(async () => {
    await playlist.clear();
    player.stop();
  }, [playlist, player]);

  const copyToClipboard = useCallback(async (text) => {
    setMenuEntry(null);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy:", text);
    }
  }, []);

  const onPickNativeJson = useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      setShowMoreMenu(false);
      if (file) {
        // Three.js native Object3D JSON is wrapped into a minimal ThreeJSON world by the runtime.
        await player.loadNativeThreeJson(file);
      }
    },
    [player]
  );

  useEffect(() => {
    if (!menuEntry && !showMoreMenu) {
      return undefined;
    }
    const close = () => {
      setMenuEntry(null);
      setShowMoreMenu(false);
    };
    document.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("resize", close);
    };
  }, [menuEntry, showMoreMenu]);

  return (
    <div className="app">
      <header className="topBar">
        <span className="title">
          {player.title || t("player.shell.topBarSceneTitle", "Scene Player")}
        </span>
        {previewActive && (
          <span className="badge" title={t("player.shell.editorPreviewHint", "Scenes are pushed live from the editor that opened this window.")}>
            {t("player.shell.editorPreview", "Editor preview")}
          </span>
        )}
        <span className="spacer" />

        <input
          type="text"
          value={urlInput}
          placeholder={t("player.shell.sceneUrlPlaceholder", "Scene URL or path…")}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void onAddUrl()}
        />
        <button onClick={() => void onAddUrl()} disabled={!urlInput.trim()}>
          {t("player.shell.load", "Add")}
        </button>
        <button onClick={() => fileInputRef.current?.click()}>
          {t("player.shell.openFile", "Open files…")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          accept=".json,.threejson,.tjson,.tjz"
          onChange={onPickFiles}
        />

        <select value={locale} onChange={(e) => void setLocale(e.target.value)} title="Locale">
          <option value="en-US">English</option>
          <option value="zh-CN">中文</option>
        </select>
        <button onClick={() => setShowSettings(true)}>{t("player.shell.settings", "Settings")}</button>

        <span style={{ position: "relative" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMoreMenu((v) => !v);
            }}
            title={t("player.shell.more", "More")}
          >
            ⋯
          </button>
          {showMoreMenu && (
            <div className="dropdown" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => nativeInputRef.current?.click()}>
                {t("player.shell.loadNativeJson", "Load native Three.js JSON…")}
              </button>
              <button
                disabled={!player.hasScene}
                onClick={() => {
                  setShowMoreMenu(false);
                  setShowMeshExport(true);
                }}
              >
                {t("threebox.sceneCard.exportMesh", "Export third-party model…")}
              </button>
              <button
                disabled={!player.hasScene}
                onClick={() => {
                  setShowMoreMenu(false);
                  void document.documentElement.requestFullscreen?.();
                }}
              >
                {t("player.shell.fullscreen", "Fullscreen")}
              </button>
            </div>
          )}
        </span>
        <input
          ref={nativeInputRef}
          type="file"
          hidden
          accept=".json"
          onChange={onPickNativeJson}
        />
      </header>

      <div className="main">
        <div className="viewportWrap" ref={player.canvasWrapRef}>
          <canvas ref={player.canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />

          {player.loading && (
            <div className="loadingMask">
              <div>{player.loadingMessage || t("player.message.loading", "Loading 3D scene…")}</div>
            </div>
          )}

          {!player.loading && !player.hasScene && (
            <div className="idleMask">
              <div>{t("player.shell.noScene", "No scene loaded.")}</div>
              <button className="primary" onClick={() => fileInputRef.current?.click()}>
                {t("player.shell.openFile", "Open files…")}
              </button>
            </div>
          )}

          {player.error && (
            <div className="errorBar">
              <span>{String(player.error.message || player.error)}</span>
              <span className="spacer" />
              <button onClick={player.clearError}>{t("player.shell.dismiss", "Dismiss")}</button>
            </div>
          )}
        </div>

        <aside className="playlistPane">
          <div className="playlistHead">
            <span>{t("player.shell.playlist", "Playlist")}</span>
            <span className="spacer" />
            <span className="muted">{playlist.entries.length}</span>
            <button
              onClick={() => void onClearPlaylist()}
              disabled={!playlist.entries.length}
              title={t("player.shell.playlistClear", "Clear playlist")}
            >
              ✕
            </button>
          </div>

          <div className="playlistList">
            {playlist.entries.map((entry, index) => (
              <div
                key={entry.id}
                className={`playlistRow${index === playlist.currentIndex ? " active" : ""}`}
                onClick={() => void playlist.activate(index)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuEntry({ index, x: e.clientX, y: e.clientY });
                }}
                title={entry.kind === "url" ? entry.url : entry.file?.name}
              >
                <span className="rowKind">{entry.kind === "url" ? "🔗" : "📄"}</span>
                <span className="rowLabel">{entry.label}</span>
              </div>
            ))}
            {!playlist.entries.length && (
              <div className="hint">{t("player.shell.playlistEmpty", "Playlist is empty.")}</div>
            )}
          </div>
        </aside>
      </div>

      <footer className="bottomBar">
        <button onClick={() => void playlist.previous()} disabled={!playlist.hasPrevious}>
          ⏮
        </button>
        <button onClick={player.togglePlayback} disabled={!player.hasScene}>
          {player.playing ? `⏸ ${t("player.shell.pause", "Pause")}` : `▶ ${t("player.shell.play", "Play")}`}
        </button>
        <button onClick={() => void playlist.next()} disabled={!playlist.hasNext}>
          ⏭
        </button>
        <button onClick={player.stop} disabled={!player.hasScene}>
          ⏹ {t("player.shell.stop", "Stop")}
        </button>
        <button onClick={player.fitViewToSceneBounds} disabled={!player.hasScene}>
          {t("player.shell.fitView", "Fit view")}
        </button>

        <span className="spacer" />

        <div className="settingsRow">
          <button onClick={player.toggleMuted} disabled={!player.hasScene}>
            {player.muted ? "🔇" : "🔊"}
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(player.volume * 100)}
            disabled={!player.hasScene}
            onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
          />
        </div>
      </footer>

      {menuEntry && (
        <div
          className="contextMenu"
          style={{ left: menuEntry.x, top: menuEntry.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => void playlist.activate(menuEntry.index)}>
            {t("player.shell.play", "Play")}
          </button>
          <button
            onClick={() => {
              const entry = playlist.entries[menuEntry.index];
              void copyToClipboard(entry?.kind === "url" ? entry.url : entry?.label || "");
            }}
          >
            {t("player.shell.copyPath", "Copy path")}
          </button>
          <button onClick={() => void onRemove(menuEntry.index)}>
            {t("player.shell.remove", "Remove")}
          </button>
        </div>
      )}

      {showSettings && <SettingsDialog api={settingsApi} onClose={() => setShowSettings(false)} />}
      {showMeshExport && (
        <MeshExportDialog
          getSceneSnapshot={player.getSnapshot}
          onClose={() => setShowMeshExport(false)}
        />
      )}
    </div>
  );
}
