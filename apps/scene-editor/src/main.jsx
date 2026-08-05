import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "@threejson/react-ui/styles.css";
// Verbatim from tools/scene-host/shared/css — the dock/chrome/panel DOM this app now reproduces
// (src/dock/*) applies this design as-is. builtin-provider-privacy.css joins once phase 7 (AI panels)
// lands the privacy-notice UI it styles.
import "./editor-base.css";
import "./host-overrides.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
