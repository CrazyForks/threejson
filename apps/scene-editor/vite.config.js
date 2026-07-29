import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5183 },
  optimizeDeps: {
    // See apps/scene-player/vite.config.js for why the workspace kits are excluded.
    exclude: [
      "@threejson/react",
      "@threejson/react-ui",
      "@threejson/host-kit",
      "@threejson/player-kit",
      "@threejson/editor-kit",
      "threejson"
    ]
  }
});
