/**
 * ThreeJSON Scene Shower — live JSON playground, built entirely on the published @threejson/*
 * packages. Like apps/scene-player, every import is a bare package specifier: no relative path into
 * the monorepo, no dependency on tools/scene-host.
 *
 *   @threejson/react    → useScenePlayer (viewport + transport state), useHostI18n (locale)
 *   @threejson/host-kit → demo-catalog/scene URL resolution, HTML template export
 *   threejson           → scene payload format conversion (friendly ⇄ standard)
 *
 * "Step one" scope: demo catalog, editable JSON with live/manual render, format conversion,
 * fit-view, and HTML template export. The original shower's native-JSON export, mesh export,
 * three-view, scene-tree tab, and theme switching are not reimplemented yet.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScenePlayer, useHostI18n } from "@threejson/react";
import { MeshExportDialog } from "@threejson/react-ui";
import { resolveSceneHostUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import {
  buildHtmlTemplate,
  jsonStringForScript
} from "@threejson/host-kit/js/templateExportBuilders.js";
import {
  toFriendlyScenePayload,
  toStandardScenePayload
} from "@threejson/host-kit/js/scenePayloadViews.js";
import { detectScenePayloadViewFormat } from "threejson";
import { labelsFor, localizedField } from "./labels.js";
import { openSceneInEditor } from "./sceneTransferProtocol.js";

const MANIFEST_URL = "assets/json/demo-show/manifest.json";
const AUTO_RENDER_DELAY_MS = 700;

function downloadTextFile(text, fileName, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const { locale, setLocale } = useHostI18n();
  const L = labelsFor(locale);
  const player = useScenePlayer();

  const [sections, setSections] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [jsonText, setJsonText] = useState("");
  const [autoRun, setAutoRun] = useState(true);
  const [toast, setToast] = useState(null);
  const [showMeshExport, setShowMeshExport] = useState(false);
  const autoRunTimerRef = useRef(null);

  // Demo catalog. resolveSceneHostUrl turns the manifest's repo-relative paths into real URLs
  // (the @threejson/assets CDN by default), so this works with no local assets/ folder.
  useEffect(() => {
    let cancelled = false;
    fetch(resolveSceneHostUrl(MANIFEST_URL))
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) {
          setSections(Array.isArray(data) ? data : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSections([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const renderJson = useCallback(
    (text) => {
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        setToast({ kind: "error", text: L.parseFailed + error.message });
        return;
      }
      setToast(null);
      void player.loadFromPayload(payload);
    },
    [player, L.parseFailed]
  );

  const openDemo = useCallback(
    async (item) => {
      setActiveId(item.id);
      try {
        const response = await fetch(resolveSceneHostUrl(item.json));
        const text = await response.text();
        setJsonText(text);
        renderJson(text);
      } catch (error) {
        setToast({ kind: "error", text: String(error.message || error) });
      }
    },
    [renderJson]
  );

  // Auto-load the first demo once the runtime exists and the catalog has arrived.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!player.ready) {
      autoOpenedRef.current = false;
      return;
    }
    if (autoOpenedRef.current || !sections.length) {
      return;
    }
    const first = sections.find((s) => s.items?.length)?.items?.[0];
    if (first) {
      autoOpenedRef.current = true;
      void openDemo(first);
    }
  }, [player.ready, sections, openDemo]);

  // Live render: debounce edits so a partially-typed JSON does not spam failed parses.
  useEffect(() => {
    if (!autoRun || !jsonText.trim() || !player.ready) {
      return undefined;
    }
    clearTimeout(autoRunTimerRef.current);
    autoRunTimerRef.current = setTimeout(() => renderJson(jsonText), AUTO_RENDER_DELAY_MS);
    return () => clearTimeout(autoRunTimerRef.current);
  }, [jsonText, autoRun, player.ready, renderJson]);

  const setFormat = useCallback(
    (target) => {
      let payload;
      try {
        payload = JSON.parse(jsonText);
      } catch (error) {
        setToast({ kind: "error", text: L.parseFailed + error.message });
        return;
      }
      const current = detectScenePayloadViewFormat(payload);
      if (current === target) {
        setToast({ kind: "info", text: target === "friendly" ? L.alreadyFriendly : L.alreadyStandard });
        return;
      }
      const converted =
        target === "friendly" ? toFriendlyScenePayload(payload) : toStandardScenePayload(payload);
      const text = JSON.stringify(converted, null, 2);
      setJsonText(text);
      renderJson(text);
    },
    [jsonText, renderJson, L]
  );

  const exportHtml = useCallback(() => {
    if (!jsonText.trim()) {
      return;
    }
    try {
      JSON.parse(jsonText);
    } catch (error) {
      setToast({ kind: "error", text: L.parseFailed + error.message });
      return;
    }
    const html = buildHtmlTemplate({
      sceneJsonText: jsonStringForScript(JSON.parse(jsonText)),
      inlineJson: true
    });
    downloadTextFile(html, "threejson-scene.html", "text/html;charset=utf-8");
    setToast({ kind: "info", text: L.exported });
  }, [jsonText, L]);

  // Native JSON export: the canonical (standard) payload, which is what the engine actually
  // consumes — distinct from whatever authoring view the textarea currently holds.
  const exportNativeJson = useCallback(() => {
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (error) {
      setToast({ kind: "error", text: L.parseFailed + error.message });
      return;
    }
    const canonical = toStandardScenePayload(payload);
    downloadTextFile(
      JSON.stringify(canonical, null, 2),
      "threejson-scene.json",
      "application/json;charset=utf-8"
    );
    setToast({ kind: "info", text: L.exportedJson });
  }, [jsonText, L]);

  const openInEditor = useCallback(async () => {
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (error) {
      setToast({ kind: "error", text: L.parseFailed + error.message });
      return;
    }
    try {
      await openSceneInEditor(payload, payload?.name || "ThreeJSON Shower");
      setToast({ kind: "info", text: L.editorOpened });
    } catch (error) {
      setToast({ kind: "error", text: L.editorOpenFailed + String(error?.message || error) });
    }
  }, [jsonText, L]);

  const formatJson = useCallback(() => {
    try {
      setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
    } catch (error) {
      setToast({ kind: "error", text: L.parseFailed + error.message });
    }
  }, [jsonText, L.parseFailed]);

  const catalog = useMemo(
    () =>
      sections.map((section) => (
        <div className="section" key={section.section}>
          <div className="sectionTitle">{localizedField(section, "sectionTitle", locale)}</div>
          {(section.items || []).map((item) => (
            <button
              type="button"
              key={item.id}
              className={`item${activeId === item.id ? " active" : ""}`}
              onClick={() => void openDemo(item)}
            >
              <div>{localizedField(item, "title", locale)}</div>
              <div className="itemDesc">{localizedField(item, "desc", locale)}</div>
            </button>
          ))}
        </div>
      )),
    [sections, activeId, locale, openDemo]
  );

  return (
    <div className="app">
      <aside className="catalog">
        <div className="catalogTitle">{L.catalog}</div>
        {catalog}
      </aside>

      <div className="center">
        <div className="bar">
          <button onClick={player.fitViewToSceneBounds} disabled={!player.hasScene}>
            {L.fit}
          </button>
          <span className="spacer" />
          <label className="check" htmlFor="lang">
            {L.language}
          </label>
          <select id="lang" value={locale} onChange={(e) => void setLocale(e.target.value)}>
            <option value="en-US">English</option>
            <option value="zh-CN">中文</option>
          </select>
        </div>

        <div className="viewportWrap" ref={player.canvasWrapRef}>
          <canvas ref={player.canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
          {player.loading && <div className="mask">{player.loadingMessage || L.loading}</div>}
          {!player.loading && !player.hasScene && <div className="mask">{L.empty}</div>}
          {toast && (
            <div className={`toast ${toast.kind}`}>
              <span>{toast.text}</span>
              <span className="spacer" />
              <button onClick={() => setToast(null)}>{L.dismiss}</button>
            </div>
          )}
        </div>
      </div>

      <section className="editorPane">
        <div className="bar">
          <button className="primary" onClick={() => renderJson(jsonText)} disabled={!jsonText.trim()}>
            ▶ {L.run}
          </button>
          <label className="check">
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
            {L.autoRun}
          </label>
        </div>

        <textarea
          className="editor"
          spellCheck={false}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
        />

        <div className="bar">
          <button onClick={formatJson} disabled={!jsonText.trim()}>
            {L.format}
          </button>
          <button onClick={() => setFormat("friendly")} disabled={!jsonText.trim()}>
            {L.friendly}
          </button>
          <button onClick={() => setFormat("standard")} disabled={!jsonText.trim()}>
            {L.standard}
          </button>
          <span className="spacer" />
          <button onClick={exportNativeJson} disabled={!jsonText.trim()}>
            {L.exportJson}
          </button>
          <button onClick={exportHtml} disabled={!jsonText.trim()}>
            {L.exportHtml}
          </button>
          <button onClick={() => void openInEditor()} disabled={!jsonText.trim()}>
            {L.openInEditor}
          </button>
          <button onClick={() => setShowMeshExport(true)} disabled={!player.hasScene}>
            {L.exportModel}
          </button>
        </div>
      </section>

      {showMeshExport && (
        <MeshExportDialog
          getSceneSnapshot={player.getSnapshot}
          onClose={() => setShowMeshExport(false)}
          onExported={({ fileName }) => setToast({ kind: "info", text: `${L.exported} ${fileName}` })}
        />
      )}
    </div>
  );
}
