import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5180 },
  optimizeDeps: {
    // The @threejson/* kits are workspace symlinks containing raw, unbundled ESM. Excluding them
    // from Vite's dependency pre-bundling means edits inside packages/ are picked up immediately
    // during development instead of being frozen into a cached optimized bundle — and it guarantees
    // a single shared `threejson` instance across the kits (pre-bundling a subset can otherwise
    // duplicate the engine's module-level state, e.g. its asset-base and domain registries).
    exclude: ["@threejson/react",
      "@threejson/react-ui", "@threejson/host-kit", "@threejson/player-kit", "threejson"]
  }
});
