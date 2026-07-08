export const SCENE_HOST_REPO_ROOT_URL = new URL("../../../../", import.meta.url).href;

export function resolveSceneHostUrl(value, baseUrl = SCENE_HOST_REPO_ROOT_URL) {
  const raw = String(value || "").trim();
  if (!raw) {
    return raw;
  }
  if (/^(?:[a-z]+:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
    return raw;
  }
  if (raw === "/demo.html" || raw === "./demo.html" || raw === "demo.html") {
    return new URL("examples/html-demo/demo.html", baseUrl).href;
  }
  const clean = raw
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
  return new URL(clean, baseUrl).href;
}

export function sceneHostAssetUrl(path = "") {
  const clean = String(path || "").replace(/^(\.\.\/)+/, "").replace(/^\.\//, "").replace(/^\//, "");
  return new URL(clean || "assets/", SCENE_HOST_REPO_ROOT_URL).href;
}
