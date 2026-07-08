import * as THREE from "three";
import { createJsonScene } from "threejson/core";
import { resolveSceneHostUrl, sceneHostAssetUrl } from "../../shared/js/sceneHostPaths.js";

const STORAGE_AUTO_RUN = "threejson.shower.autoRun";
const params = new URLSearchParams(window.location.search);
const lang = params.get("lang") || (navigator.language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US");

const labels = {
  "zh-CN": {
    autoRun: "实时",
    coreJson: "核心JSON",
    fullJson: "完整JSON",
    sceneTree: "场景树",
    friendlyJson: "友好JSON",
    standardJson: "标准JSON",
    format: "格式化",
    run: "运行",
    downloadHtml: "下载",
    export: "导出",
    nativeJson: "原生JSON",
    modelExport: "三方模型",
    threeView: "三视图",
    fit: "自适应",
    fullscreen: "全屏",
    loading: "加载中...",
    ready: "Ready",
    noObjects: "暂无对象",
    parseFailed: "JSON 解析失败：",
    exportUnavailable: "当前版本先提供 JSON 导出，三方模型导出后续补齐。"
  },
  "en-US": {
    autoRun: "Live",
    coreJson: "Core JSON",
    fullJson: "Full JSON",
    sceneTree: "Scene Tree",
    friendlyJson: "Friendly JSON",
    standardJson: "Standard JSON",
    format: "Format",
    run: "Run",
    downloadHtml: "Download",
    export: "Export",
    nativeJson: "Native JSON",
    modelExport: "Model",
    threeView: "Three Views",
    fit: "Fit",
    fullscreen: "Fullscreen",
    loading: "Loading...",
    ready: "Ready",
    noObjects: "No objects",
    parseFailed: "JSON parse failed: ",
    exportUnavailable: "This build exports JSON first. Third-party model export will be added later."
  }
};

const t = (key) => labels[lang]?.[key] || labels["zh-CN"][key] || key;

const els = {
  title: document.getElementById("exampleTitle"),
  status: document.getElementById("statusText"),
  editorPanel: document.getElementById("editorPanel"),
  treePanel: document.getElementById("treePanel"),
  jsonToolbar: document.getElementById("jsonToolbar"),
  autoRun: document.getElementById("autoRunCheckbox"),
  canvas: document.getElementById("canvasContainer"),
  canvasWrap: document.getElementById("canvasWrap"),
  loading: document.getElementById("loadingMask")
};

let fullJson = null;
let activeTab = "core";
let editor = null;
let runtime = null;
let highlightHelper = null;
let runTimer = 0;
let viewModeIndex = 0;
const viewModes = ["iso", "top", "front", "side"];

init();

async function init() {
  document.documentElement.lang = lang === "zh-CN" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  els.status.textContent = t("ready");
  els.autoRun.checked = localStorage.getItem(STORAGE_AUTO_RUN) === "1";
  els.autoRun.addEventListener("change", () => {
    localStorage.setItem(STORAGE_AUTO_RUN, els.autoRun.checked ? "1" : "0");
  });

  editor = window.CodeMirror(els.editorPanel, {
    value: "{}",
    mode: { name: "javascript", json: true },
    theme: "material-darker",
    lineNumbers: true,
    tabSize: 2,
    indentUnit: 2
  });
  editor.on("change", () => {
    if (els.autoRun.checked && activeTab !== "tree") {
      clearTimeout(runTimer);
      runTimer = window.setTimeout(runFromEditor, 450);
    }
  });

  wireControls();
  await loadInitialJson();
}

function wireControls() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
  document.getElementById("formatBtn").addEventListener("click", formatEditor);
  document.getElementById("runBtn").addEventListener("click", runFromEditor);
  document.getElementById("friendlyBtn").addEventListener("click", () => setEditorJson(toFriendly(readEditorJson())));
  document.getElementById("standardBtn").addEventListener("click", () => setEditorJson(toStandard(readEditorJson())));
  document.getElementById("downloadHtmlBtn").addEventListener("click", downloadHtml);
  document.getElementById("exportThreeJsonBtn").addEventListener("click", () => downloadText("threejson-scene.json", JSON.stringify(readCurrentScene(), null, 2)));
  document.getElementById("exportNativeBtn").addEventListener("click", () => downloadText("threejson-native-placeholder.json", JSON.stringify(readCurrentScene(), null, 2)));
  document.getElementById("exportModelBtn").addEventListener("click", () => alert(t("exportUnavailable")));
  document.getElementById("fitBtn").addEventListener("click", fitView);
  document.getElementById("threeViewBtn").addEventListener("click", cycleViewMode);
  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else els.canvasWrap.requestFullscreen?.();
  });
  els.canvas.addEventListener("click", (event) => {
    if (event.detail <= 1) {
      clearHighlight();
      setActiveTreeNode("");
    }
  });
  els.canvas.addEventListener("dblclick", (event) => {
    const picked = pickObject(event);
    if (!picked) {
      clearHighlight();
      setActiveTreeNode("");
      return;
    }
    const id = getSceneObjectId(picked);
    highlightObject(id, picked);
    setActiveTreeNode(id);
  });
  window.addEventListener("resize", () => runtime?.resize?.(els.canvasWrap.clientWidth, els.canvasWrap.clientHeight));
}

async function loadInitialJson() {
  const raw = params.get("json") || "assets/json/demo-show/01-box.json";
  const url = resolveSceneHostUrl(raw);
  showLoading(true);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fullJson = await res.json();
    els.title.textContent = fullJson.name || fullJson.threeJsonId || "ThreeJSON Shower";
    setTab("core");
    await runScene(fullJson);
  } catch (error) {
    els.status.textContent = String(error.message || error);
  } finally {
    showLoading(false);
  }
}

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  const isTree = tab === "tree";
  els.editorPanel.hidden = isTree;
  els.jsonToolbar.hidden = isTree;
  els.treePanel.hidden = !isTree;
  if (tab === "core") setEditorJson(toCore(fullJson));
  if (tab === "full") setEditorJson(fullJson);
  if (tab === "tree") renderTree();
  editor.refresh();
}

function setEditorJson(value) {
  editor.setValue(JSON.stringify(value || {}, null, 2));
}

function readEditorJson() {
  return JSON.parse(editor.getValue());
}

function readCurrentScene() {
  if (activeTab === "core") return mergeCoreIntoFull(readEditorJson());
  if (activeTab === "full") return readEditorJson();
  return fullJson;
}

function formatEditor() {
  try {
    setEditorJson(readEditorJson());
    els.status.textContent = t("ready");
  } catch (error) {
    els.status.textContent = t("parseFailed") + error.message;
  }
}

async function runFromEditor() {
  try {
    await runScene(readCurrentScene());
  } catch (error) {
    els.status.textContent = t("parseFailed") + error.message;
    showLoading(false);
  }
}

async function runScene(sceneJson) {
  showLoading(true);
  clearHighlight();
  runtime?.dispose?.();
  fullJson = structuredClone(sceneJson);
  fullJson.canvasWidth = els.canvasWrap.clientWidth;
  fullJson.canvasHeight = els.canvasWrap.clientHeight;
  try {
    runtime = await createJsonScene(fullJson, {
      canvas: els.canvas,
      assetsBase: sceneHostAssetUrl("assets/"),
      resetScene: true
    });
    runtime.start?.();
    renderTree();
    els.status.textContent = t("ready");
  } finally {
    showLoading(false);
  }
}

function toCore(sceneJson) {
  const core = {
    name: sceneJson?.name,
    worldInfo: structuredClone(sceneJson?.worldInfo || {})
  };
  if (shouldExposeSceneConfigInCore(sceneJson)) {
    core.sceneConfig = structuredClone(sceneJson?.sceneConfig || {});
  }
  return core;
}

function shouldExposeSceneConfigInCore(sceneJson) {
  const key = String(`${sceneJson?.name || ""} ${sceneJson?.threeJsonId || ""}`).toLowerCase();
  return /light|camera|scene|renderer|control/.test(key);
}

function mergeCoreIntoFull(core) {
  const base = structuredClone(fullJson || {});
  if (core.name !== undefined) base.name = core.name;
  base.worldInfo = structuredClone(core.worldInfo || {});
  if (core.sceneConfig !== undefined) {
    base.sceneConfig = structuredClone(core.sceneConfig || {});
  }
  return base;
}

function toFriendly(json) {
  return structuredClone(json);
}

function toStandard(json) {
  const next = structuredClone(json);
  if (next.worldInfo) {
    for (const list of Object.values(next.worldInfo)) {
      if (Array.isArray(list)) {
        list.forEach((item) => {
          if (item.objType || item.threeJsonId) return;
          if (item.geometry?.radius) item.objType = "sphere";
        });
      }
    }
  }
  return next;
}

function renderTree() {
  const groups = collectObjectGroups(fullJson);
  els.treePanel.innerHTML = groups.length
    ? groups.map((group) => `
      <details class="treeGroup" open>
        <summary>${escapeHtml(group.name)}</summary>
        ${group.items.map((record) => `<button class="treeNode" data-id="${escapeHtml(record.id)}" type="button">${escapeHtml(record.label)}</button>`).join("")}
      </details>`).join("")
    : `<p>${t("noObjects")}</p>`;
  els.treePanel.querySelectorAll(".treeNode").forEach((node) => {
    node.addEventListener("click", () => {
      setActiveTreeNode(node.dataset.id);
      highlightObject(node.dataset.id);
    });
  });
}

function collectObjectGroups(sceneJson) {
  const groups = [];
  const worldInfo = sceneJson?.worldInfo || {};
  for (const [listName, list] of Object.entries(worldInfo)) {
    if (!Array.isArray(list) || !list.length) continue;
    groups.push({
      name: listName,
      items: list.map((item, index) => {
        const id = String(item.threeJsonId || item.name || `${listName}-${index}`);
        const type = item.objType || listName.replace(/ModelList$/i, "");
        return { id, label: `${id} / ${type}` };
      })
    });
  }
  return groups;
}

function collectObjectRecords(sceneJson) {
  return collectObjectGroups(sceneJson).flatMap((group) => group.items);
}

function highlightObject(id, fallbackObject = null) {
  clearHighlight();
  const scene = runtime?.scene;
  if (!scene) return;
  const target = (id ? scene.getObjectByName(id) || findByUserData(scene, id) : null) || fallbackObject;
  if (!target) return;
  highlightHelper = new THREE.BoxHelper(target, 0xffb020);
  scene.add(highlightHelper);
}

function findByUserData(root, id) {
  let found = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.userData?.threeJsonId === id || obj.userData?.name === id || obj.userData?.objJson?.threeJsonId === id) {
      found = obj;
    }
  });
  return found;
}

function setActiveTreeNode(id) {
  els.treePanel.querySelectorAll(".treeNode").forEach((node) => {
    const active = Boolean(id) && node.dataset.id === id;
    node.classList.toggle("active", active);
    if (active) {
      node.closest("details")?.setAttribute("open", "");
      node.scrollIntoView({ block: "nearest" });
    }
  });
}

function clearHighlight() {
  if (highlightHelper?.parent) highlightHelper.parent.remove(highlightHelper);
  highlightHelper?.geometry?.dispose?.();
  highlightHelper?.material?.dispose?.();
  highlightHelper = null;
}

function fitView() {
  fitCameraToScene("iso");
}

function cycleViewMode() {
  viewModeIndex = (viewModeIndex + 1) % viewModes.length;
  fitCameraToScene(viewModes[viewModeIndex]);
}

function fitCameraToScene(mode = "iso") {
  const scene = runtime?.scene;
  const camera = runtime?.camera;
  if (!scene || !camera) return;
  const bounds = new THREE.Box3().setFromObject(scene);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1);
  const distance = Math.max(radius * 1.8, radius / Math.tan(THREE.MathUtils.degToRad(camera.fov || 50) / 2));
  const directions = {
    iso: new THREE.Vector3(1, 0.75, 1),
    top: new THREE.Vector3(0, 1, 0.001),
    front: new THREE.Vector3(0, 0, 1),
    side: new THREE.Vector3(1, 0, 0)
  };
  const dir = (directions[mode] || directions.iso).clone().normalize();
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance / 1000);
  camera.far = Math.max(camera.far || 0, distance * 8);
  camera.lookAt(center);
  camera.updateProjectionMatrix?.();
  runtime.controls?.target?.copy?.(center);
  runtime.controls?.update?.();
  runtime.resize?.(els.canvasWrap.clientWidth, els.canvasWrap.clientHeight);
}

function pickObject(event) {
  const scene = runtime?.scene;
  const camera = runtime?.camera;
  if (!scene || !camera) return null;
  const rect = els.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1)
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(scene.children, true).find((item) => isScenePickable(item.object));
  return hit?.object || null;
}

function isScenePickable(obj) {
  if (!obj || obj.type === "GridHelper" || obj.type === "AxesHelper" || obj.type === "BoxHelper") return false;
  if (obj.isLight || obj.isCamera) return false;
  return Boolean(getSceneObjectId(obj));
}

function getSceneObjectId(obj) {
  let cur = obj;
  const ids = new Set(collectObjectRecords(fullJson).map((record) => record.id));
  while (cur) {
    const id = cur.userData?.threeJsonId || cur.userData?.objJson?.threeJsonId || cur.name;
    if (id && ids.has(String(id))) return String(id);
    cur = cur.parent;
  }
  return "";
}

function downloadHtml() {
  const json = JSON.stringify(readCurrentScene(), null, 2).replace(/<\/script/gi, "<\\/script");
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThreeJSON Scene</title>
  <script type="importmap">{"imports":{"threejson":"https://cdn.jsdelivr.net/npm/threejson/builtins/full.js","threejson/core":"https://cdn.jsdelivr.net/npm/threejson/core/index.js","three":"https://esm.sh/three@0.184.0","three/examples/jsm/":"https://esm.sh/three@0.184.0/examples/jsm/","@tweenjs/tween.js":"https://esm.sh/@tweenjs/tween.js@25.0.0"}}</script>
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}canvas{display:block;width:100%;height:100%}</style>
</head>
<body>
<canvas id="canvas"></canvas>
<script type="module">
import { createJsonScene } from "threejson/core";
const sceneJson = ${json};
const runtime = await createJsonScene(sceneJson, { canvas: document.getElementById("canvas"), resetScene: true });
runtime.start();
window.addEventListener("resize", () => runtime.resize?.(innerWidth, innerHeight));
</script>
</body>
</html>`;
  downloadText("threejson-scene.html", html, "text/html");
}

function downloadText(filename, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function showLoading(visible) {
  els.loading.textContent = t("loading");
  els.loading.classList.toggle("visible", Boolean(visible));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
