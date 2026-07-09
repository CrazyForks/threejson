import { packJsonSceneArchive, sceneToJson } from "threejson";
import { strToU8, unzipSync, zipSync } from "fflate";

const ASSETS_CDN = "https://cdn.jsdelivr.net/npm/@threejson/assets@latest/assets/";

function jsonStringForScript(payload, indent = 2) {
  return JSON.stringify(payload, null, indent).replace(/<\/script/gi, "<\\/script");
}

function buildImportMapHtml() {
  return `<script type="importmap">
    {
      "imports": {
        "threejson": "https://cdn.jsdelivr.net/npm/threejson/builtins/full.js",
        "threejson/core": "https://cdn.jsdelivr.net/npm/threejson/core/index.js",
        "three": "https://esm.sh/three@0.184.0",
        "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
        "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0",
        "fflate": "https://esm.sh/fflate@0.8.3",
        "html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4",
        "gifuct-js": "https://esm.sh/gifuct-js@2.1.2",
        "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0",
        "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10",
        "troika-three-text": "https://esm.sh/troika-three-text@0.52.4?deps=three@0.184.0"
      }
    }
  </script>`;
}

function buildHtmlTemplate({ sceneJsonText, inlineJson }) {
  const sceneSource = inlineJson
    ? `const sceneJson = ${sceneJsonText};`
    : `const sceneJson = await fetch("./assets/json/scene.json").then((response) => response.json());`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThreeJSON Scene</title>
  <link rel="icon" href="${ASSETS_CDN}img/threejson.ico" type="image/x-icon">
  ${buildImportMapHtml()}
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #11151b; }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script type="module">
    import { createJsonScene } from "threejson/core";
    ${sceneSource}
    const canvas = document.getElementById("canvas");
    const runtime = await createJsonScene(sceneJson, {
      canvas,
      resetScene: true,
      assetsBase: "${ASSETS_CDN}"
    });
    runtime.start?.();
    runtime.resize?.(innerWidth, innerHeight);
    window.addEventListener("resize", () => runtime.resize?.(innerWidth, innerHeight));
  </script>
</body>
</html>
`;
}

function buildPackageJson(type) {
  const scripts =
    type === "electron"
      ? { dev: "vite --host 0.0.0.0", start: "electron .", build: "vite build" }
      : { dev: "vite --host 0.0.0.0", build: "vite build", preview: "vite preview" };
  const deps = {
    threejson: "latest",
    three: "^0.184.0",
    "@tweenjs/tween.js": "^25.0.0",
    fflate: "^0.8.3",
    "html2canvas-pro": "^2.0.4",
    "gifuct-js": "^2.1.2",
    "three-mesh-bvh": "^0.9.10",
    "three-bvh-csg": "^0.0.18",
    "troika-three-text": "^0.52.4"
  };
  if (type === "react") {
    deps["@vitejs/plugin-react"] = "latest";
    deps.react = "latest";
    deps["react-dom"] = "latest";
    deps.vite = "latest";
  } else if (type === "vue") {
    deps["@vitejs/plugin-vue"] = "latest";
    deps.vue = "latest";
    deps.vite = "latest";
  } else if (type === "electron") {
    deps.electron = "latest";
    deps.vite = "latest";
  }
  return JSON.stringify({ type: "module", scripts, dependencies: deps }, null, 2);
}

function buildReactFiles() {
  return {
    "index.html": `<div id="root"></div><script type="module" src="/src/main.jsx"></script>`,
    "src/main.jsx": `import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createJsonScene } from "threejson/core";
import sceneJson from "../assets/json/scene.json";
import "./style.css";

function App() {
  const canvasRef = useRef(null);
  useEffect(() => {
    let runtime;
    let disposed = false;
    createJsonScene(sceneJson, { canvas: canvasRef.current, resetScene: true, assetsBase: "${ASSETS_CDN}" })
      .then((value) => {
        if (disposed) return;
        runtime = value;
        runtime.start?.();
        runtime.resize?.(innerWidth, innerHeight);
      });
    const onResize = () => runtime?.resize?.(innerWidth, innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      runtime?.dispose?.();
    };
  }, []);
  return <canvas ref={canvasRef} />;
}

createRoot(document.getElementById("root")).render(<App />);
`,
    "src/style.css": `html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#11151b}canvas{display:block;width:100%;height:100%}`
  };
}

function buildVueFiles() {
  return {
    "index.html": `<div id="app"></div><script type="module" src="/src/main.js"></script>`,
    "src/main.js": `import { createApp, onMounted, onBeforeUnmount, ref } from "vue";
import { createJsonScene } from "threejson/core";
import sceneJson from "../assets/json/scene.json";
import "./style.css";

createApp({
  setup() {
    const canvasRef = ref(null);
    let runtime;
    const onResize = () => runtime?.resize?.(innerWidth, innerHeight);
    onMounted(async () => {
      runtime = await createJsonScene(sceneJson, { canvas: canvasRef.value, resetScene: true, assetsBase: "${ASSETS_CDN}" });
      runtime.start?.();
      runtime.resize?.(innerWidth, innerHeight);
      window.addEventListener("resize", onResize);
    });
    onBeforeUnmount(() => {
      window.removeEventListener("resize", onResize);
      runtime?.dispose?.();
    });
    return { canvasRef };
  },
  template: "<canvas ref=\\"canvasRef\\"></canvas>"
}).mount("#app");
`,
    "src/style.css": `html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:#11151b}canvas{display:block;width:100%;height:100%}`
  };
}

function buildElectronFiles() {
  return {
    "index.html": `<canvas id="canvas"></canvas><script type="module" src="/src/renderer.js"></script>`,
    "main.js": `import { app, BrowserWindow } from "electron";

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 800 });
  win.loadFile("dist/index.html");
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
`,
    "src/renderer.js": `import { createJsonScene } from "threejson/core";
import sceneJson from "../assets/json/scene.json";
import "./style.css";

const canvas = document.getElementById("canvas");
const runtime = await createJsonScene(sceneJson, { canvas, resetScene: true, assetsBase: "${ASSETS_CDN}" });
runtime.start?.();
runtime.resize?.(innerWidth, innerHeight);
window.addEventListener("resize", () => runtime.resize?.(innerWidth, innerHeight));
`,
    "src/style.css": `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11151b}canvas{display:block;width:100%;height:100%}`
  };
}

function addTextFile(zipEntries, path, text) {
  zipEntries[path] = strToU8(text);
}

function rewritePackRefsForTemplate(value) {
  if (typeof value === "string") {
    return value.trim().toLowerCase().startsWith("pack://")
      ? `./${value.trim().slice("pack://".length).replace(/^\/+/, "")}`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePackRefsForTemplate(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = rewritePackRefsForTemplate(item);
    }
    return out;
  }
  return value;
}

export function createEditorTemplateExportModal(host) {
  const modal = document.getElementById("templateExportModal");
  const typeSelect = document.getElementById("templateExportTypeSelect");
  const formatSelect = document.getElementById("templateExportFormatSelect");
  const jsonLocationSelect = document.getElementById("templateExportJsonLocationSelect");
  const assetPolicySelect = document.getElementById("templateExportAssetPolicySelect");
  const fetchExternalUrlsCheckbox = document.getElementById("templateExportFetchExternalUrlsCheckbox");

  function close() {
    modal?.classList.remove("visible");
  }

  function syncDefaults() {
    const type = typeSelect?.value || "html";
    if (jsonLocationSelect) {
      jsonLocationSelect.value = type === "html" ? "inline" : "external";
    }
    if (formatSelect) {
      const sceneJson = host.getEditorSettings()?.sceneJson;
      formatSelect.value =
        sceneJson?.codeViewFormatWriteback &&
        (sceneJson?.codeViewFormat === "friendly" || sceneJson?.codeViewFormat === "standard")
          ? sceneJson.codeViewFormat
          : "standard";
    }
    syncControls();
  }

  function syncControls() {
    const packMode = assetPolicySelect?.value === "tryPack";
    if (fetchExternalUrlsCheckbox) {
      fetchExternalUrlsCheckbox.disabled = !packMode;
      if (!packMode) {
        fetchExternalUrlsCheckbox.checked = false;
      }
    }
  }

  function open() {
    syncDefaults();
    modal?.classList.add("visible");
  }

  async function buildScenePayload(format) {
    await host.ensureCanvasSyncedBeforeExport?.();
    const scene = host.getScene();
    if (!scene?.isScene) {
      throw new Error("场景尚未初始化，无法导出。");
    }
    return sceneToJson(
      scene,
      host.buildSceneToJsonOptions?.({
        merge: false,
        format
      }) ?? { format }
    );
  }

  async function buildPackedScenePayloadAndAssets(format, fetchExternalUrls) {
    const scene = host.getScene();
    const sceneRuntime = host.getSceneRuntime?.();
    const bytes = await packJsonSceneArchive(sceneRuntime || scene, {
      format,
      assetPolicy: "tryPack",
      fetchExternalUrls,
      includeRuntimeRecords: true,
      outputType: "bytes"
    });
    const unzipped = unzipSync(bytes);
    const textDecoder = new TextDecoder();
    const sceneJsonBytes = unzipped["scene.json"];
    if (!sceneJsonBytes) {
      throw new Error("tryPack 结果缺少 scene.json。");
    }
    const payload = rewritePackRefsForTemplate(JSON.parse(textDecoder.decode(sceneJsonBytes)));
    const assets = {};
    for (const [path, data] of Object.entries(unzipped)) {
      if (path.startsWith("assets/")) {
        assets[path] = data;
      }
    }
    return { payload, assets };
  }

  async function confirmExport() {
    const type = typeSelect?.value || "html";
    const format = formatSelect?.value || "standard";
    const jsonLocation = jsonLocationSelect?.value || (type === "html" ? "inline" : "external");
    const assetPolicy = assetPolicySelect?.value || "preserve";
    close();
    host.closeAllDropdowns?.();
    try {
      await host.runWithLoadingMask?.("正在导出模板...", async () => {
        const packMode = assetPolicy === "tryPack";
        const packed = packMode
          ? await buildPackedScenePayloadAndAssets(format, Boolean(fetchExternalUrlsCheckbox?.checked))
          : null;
        const payload = packed?.payload ?? (await buildScenePayload(format));
        const sceneJsonText = jsonStringForScript(payload, host.getEditorSettings()?.io?.exportJsonIndent ?? 2);
        const inlineJson = jsonLocation === "inline";
        const html = buildHtmlTemplate({ sceneJsonText, inlineJson });
        const downloader = host.getExportDownload?.();
        if (type === "html" && inlineJson && assetPolicy !== "tryPack") {
          const blob = new Blob([html], { type: "text/html" });
          const ok = await downloader?.triggerBlobDownload?.(blob, `threejson-template-${Date.now()}.html`, {
            title: "导出 HTML 模板"
          });
          if (!ok) {
            throw new Error("__export_cancelled__");
          }
          return;
        }
        const entries = {};
        if (type === "html") {
          addTextFile(entries, "index.html", html);
        } else {
          addTextFile(entries, "package.json", buildPackageJson(type));
          const files = type === "react" ? buildReactFiles() : type === "vue" ? buildVueFiles() : buildElectronFiles();
          for (const [path, text] of Object.entries(files)) {
            addTextFile(entries, path, text);
          }
        }
        if (!inlineJson || type !== "html") {
          addTextFile(entries, "assets/json/scene.json", `${sceneJsonText}\n`);
        }
        if (packed?.assets) {
          for (const [path, data] of Object.entries(packed.assets)) {
            entries[path] = data;
          }
        }
        const zip = zipSync(entries, { level: 6 });
        const blob = new Blob([zip], { type: "application/zip" });
        const ok = await downloader?.triggerBlobDownload?.(blob, `threejson-template-${type}-${Date.now()}.zip`, {
          title: "导出模板"
        });
        if (!ok) {
          throw new Error("__export_cancelled__");
        }
      });
      host.showMessage("模板已导出。", "success");
    } catch (error) {
      if (String(error?.message || error) === "__export_cancelled__") {
        return;
      }
      console.error(error);
      host.showMessage(`导出模板失败：${error?.message || error}`, "error");
    }
  }

  function init() {
    typeSelect?.addEventListener("change", syncDefaults);
    assetPolicySelect?.addEventListener("change", syncControls);
    document.getElementById("templateExportCancelBtn")?.addEventListener("click", close);
    document.getElementById("templateExportConfirmBtn")?.addEventListener("click", () => {
      void confirmExport();
    });
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        close();
      }
    });
    document.getElementById("menuExportTemplate")?.addEventListener("click", () => {
      open();
      host.closeAllDropdowns?.();
    });
  }

  return { init, open, close, confirmExport };
}
