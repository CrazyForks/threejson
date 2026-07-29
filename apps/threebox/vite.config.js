import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// ── Dev-only AI provider test channel ────────────────────────────────────────
// A gitignored settings.test.json lets a developer point ThreeBox's AI provider at a real endpoint
// for manual verification of the generate / adjust / agent loops (which otherwise need the
// origin-restricted built-in backend). Two dev-only pieces make it work, and NEITHER ships in a
// production build:
//   1. A middleware that serves the credentials at /__ai-test-settings at request time, so the key
//      is read from disk only in the running dev server and is never bundled into any artifact.
//   2. A proxy at /ai-test-proxy, because LLM APIs (DeepSeek/OpenAI) do not send browser CORS
//      headers — the request must be forwarded server-side. Its target is the provider's real API
//      base, read from settings.test.json at config time.
const SETTINGS_PATH = fileURLToPath(new URL("./settings.test.json", import.meta.url));

const PROVIDER_BASE = {
  deepseek: "https://api.deepseek.com",
  chatgpt: "https://api.openai.com/v1",
  openai: "https://api.openai.com/v1"
};

function readTestSettings() {
  try {
    const cfg = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return cfg && cfg.apiKey ? cfg : null;
  } catch {
    return null;
  }
}

function testSettingsPlugin() {
  return {
    name: "threebox-ai-test-settings",
    // configureServer runs only for the dev server — this endpoint does not exist in a build.
    configureServer(server) {
      server.middlewares.use("/__ai-test-settings", (_req, res) => {
        const cfg = readTestSettings();
        res.setHeader("content-type", "application/json");
        // Only the fields the app needs; read fresh each request so edits take effect on reload.
        res.end(cfg ? JSON.stringify({ provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl }) : "null");
      });
    }
  };
}

const testCfg = readTestSettings();
const aiProxyTarget = testCfg ? testCfg.baseUrl || PROVIDER_BASE[testCfg.provider] || null : null;

export default defineConfig({
  plugins: [react(), testSettingsPlugin()],
  server: {
    port: 5182,
    ...(aiProxyTarget
      ? {
          proxy: {
            "/ai-test-proxy": {
              target: aiProxyTarget,
              changeOrigin: true,
              secure: true,
              rewrite: (path) => path.replace(/^\/ai-test-proxy/, "")
            }
          }
        }
      : {})
  },
  optimizeDeps: {
    // See apps/scene-player/vite.config.js for why the workspace kits are excluded.
    exclude: ["@threejson/react",
      "@threejson/react-ui", "@threejson/host-kit", "@threejson/player-kit", "threejson"]
  }
});
