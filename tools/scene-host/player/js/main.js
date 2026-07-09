import { bootstrapPlayerApp } from "./playerApp.js";

window.addEventListener("DOMContentLoaded", () => {
  void bootstrapPlayerApp().catch((error) => {
    console.error("[scene-host player] bootstrap failed", error);
    document.getElementById("loadingMask")?.style?.setProperty("display", "none");
    const idleOverlay = document.getElementById("canvasIdleOverlay");
    if (idleOverlay) {
      idleOverlay.classList.add("isVisible");
      idleOverlay.setAttribute("aria-hidden", "false");
    }
    const messageBox = document.getElementById("messageBox");
    if (messageBox) {
      messageBox.textContent = error instanceof Error ? error.message : String(error);
      messageBox.style.display = "block";
    }
  });
});
