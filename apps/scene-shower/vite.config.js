import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5181 },
  optimizeDeps: {
    // See apps/scene-player/vite.config.js — the @threejson/* kits are workspace symlinks of raw
    // ESM; excluding them keeps edits live and guarantees one shared `threejson` instance.
    exclude: ["@threejson/react",
      "@threejson/react-ui", "@threejson/host-kit", "@threejson/player-kit", "threejson"]
  }
});
