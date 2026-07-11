import { t } from "../../shared/i18n/index.js";

const LEFT_DOCK_PINNED_STORAGE_KEY = "threejson.threebox.leftDockPinned";
const PEEK_HIDE_DELAY_MS = 260;
const MOBILE_MEDIA_QUERY = "(max-width: 720px)";

/** A permanently "pinned" 288px sidebar would eat most of a phone-width viewport, so mobile
 * ignores the persisted pin preference entirely and always starts collapsed — the sidebar only
 * ever appears as a tap-to-open overlay there (via #mobileMenuBtn), never pushes content. */
function isMobileViewport() {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function readPinnedFromStorage() {
  if (isMobileViewport()) {
    return false;
  }
  try {
    const raw = localStorage.getItem(LEFT_DOCK_PINNED_STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch (_error) {
    return true;
  }
}

function persistPinnedToStorage(pinned) {
  try {
    localStorage.setItem(LEFT_DOCK_PINNED_STORAGE_KEY, pinned ? "1" : "0");
  } catch (_error) {
    /* ignore quota/availability errors */
  }
}

/**
 * Single-dock (left sidebar only) port of the editor's pin/auto-hide chrome pattern
 * (see tools/scene-host/editor/js/editorViewChrome.js): pinned by default, click the pin
 * button to unpin, then the sidebar hides and reveals on mouse-near-left-edge / dismisses on
 * outside click when unpinned.
 */
export function createThreeBoxViewChrome() {
  const rootContainer = document.getElementById("rootContainer");
  const leftFlyoutHost = document.getElementById("leftFlyoutHost");
  const leftDock = document.getElementById("leftDock");
  const leftDockPinBtn = document.getElementById("leftDockPinBtn");

  let leftDockPinned = readPinnedFromStorage();
  let leftDockPeek = false;
  let peekHideTimer = null;

  function syncClasses() {
    rootContainer?.classList.toggle("leftDockPinned", leftDockPinned);
    rootContainer?.classList.toggle("leftDockPeek", leftDockPeek);
    leftDock?.setAttribute("aria-hidden", leftDockPinned || leftDockPeek ? "false" : "true");
    if (leftDockPinBtn) {
      leftDockPinBtn.setAttribute("aria-pressed", leftDockPinned ? "true" : "false");
      leftDockPinBtn.title = leftDockPinned
        ? t("threebox.viewChrome.pinnedTitle", "已钉住：鼠标移开仍显示")
        : t("threebox.viewChrome.unpinnedTitle", "未钉住：移到屏幕左边缘唤出");
    }
    window.dispatchEvent(new Event("resize"));
  }

  function scheduleHide() {
    clearTimeout(peekHideTimer);
    peekHideTimer = setTimeout(() => {
      leftDockPeek = false;
      syncClasses();
    }, PEEK_HIDE_DELAY_MS);
  }

  function togglePinned() {
    if (isMobileViewport()) {
      // Pinning has no meaning on a phone-width overlay drawer — the pin button is hidden there
      // via CSS, but guard here too in case it's reachable some other way.
      return;
    }
    leftDockPinned = !leftDockPinned;
    if (leftDockPinned) {
      leftDockPeek = true;
      clearTimeout(peekHideTimer);
    } else if (!leftFlyoutHost?.matches(":hover")) {
      leftDockPeek = false;
    }
    persistPinnedToStorage(leftDockPinned);
    syncClasses();
  }

  function openMobilePeek() {
    clearTimeout(peekHideTimer);
    leftDockPeek = true;
    syncClasses();
  }

  function init() {
    leftFlyoutHost?.addEventListener("mouseenter", () => {
      clearTimeout(peekHideTimer);
      leftDockPeek = true;
      syncClasses();
    });
    leftFlyoutHost?.addEventListener("mouseleave", () => {
      if (!leftDockPinned) {
        scheduleHide();
      }
    });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!leftDockPinned && leftFlyoutHost && !leftFlyoutHost.contains(event.target)) {
          leftDockPeek = false;
          clearTimeout(peekHideTimer);
          syncClasses();
        }
      },
      true
    );
    leftDockPinBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePinned();
    });
    document.getElementById("mobileMenuBtn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      openMobilePeek();
    });
    syncClasses();
  }

  return { init, refresh: syncClasses };
}
