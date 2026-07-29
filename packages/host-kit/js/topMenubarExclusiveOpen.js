export function initTopMenubarExclusiveOpen(root = document, onOutsidePointerDown) {
  const menubars = Array.from(root.querySelectorAll(".topMenubar"));
  const menus = Array.from(root.querySelectorAll(".topMenubar > .topMenu"));
  let hoverCloseTimer = 0;

  function closeHoverMenus(scope) {
    scope.querySelectorAll?.(".topMenubar > .topMenu[open][data-hover-open='true']").forEach((details) => {
      details.removeAttribute("open");
      delete details.dataset.hoverOpen;
    });
  }

  function closeNestedMenus(scope) {
    scope.querySelectorAll?.(".topMenuNestedWrap[data-submenu-open]").forEach((item) => {
      delete item.dataset.submenuOpen;
      delete item.dataset.submenuPinned;
    });
  }

  function clearHoverCloseTimer() {
    if (hoverCloseTimer) {
      window.clearTimeout(hoverCloseTimer);
      hoverCloseTimer = 0;
    }
  }

  function scheduleHoverClose(scope) {
    clearHoverCloseTimer();
    hoverCloseTimer = window.setTimeout(() => {
      closeHoverMenus(scope);
      closeNestedMenus(scope);
      hoverCloseTimer = 0;
    }, 220);
  }

  function closeSiblingNestedMenus(item) {
    const host = item.parentElement;
    if (!host) {
      return;
    }
    Array.from(host.children).forEach((child) => {
      if (child !== item && child.classList?.contains("topMenuNestedWrap")) {
        delete child.dataset.submenuOpen;
        delete child.dataset.submenuPinned;
      }
    });
  }

  function openNestedMenu(item, options = {}) {
    closeSiblingNestedMenus(item);
    item.dataset.submenuOpen = "true";
    if (options.pinned) {
      item.dataset.submenuPinned = "true";
    } else if (!options.keepPinned) {
      delete item.dataset.submenuPinned;
    }
  }

  menus.forEach((details) => {
    const summary = details.querySelector(":scope > summary");
    let suppressNextSummaryClick = false;
    details.addEventListener("toggle", () => {
      if (!details.open) {
        delete details.dataset.hoverOpen;
        closeNestedMenus(details);
        return;
      }
      root.querySelectorAll(".topMenubar > .topMenu[open]").forEach((other) => {
        if (other !== details) {
          other.removeAttribute("open");
        }
      });
    });

    details.addEventListener("pointerenter", () => {
      clearHoverCloseTimer();
      if (!details.open) {
        details.dataset.hoverOpen = "true";
        details.setAttribute("open", "");
      }
    });

    summary?.addEventListener("pointerdown", (event) => {
      if (details.open && details.dataset.hoverOpen === "true") {
        event.preventDefault();
        suppressNextSummaryClick = true;
        delete details.dataset.hoverOpen;
      }
    });

    summary?.addEventListener("click", (event) => {
      if (!suppressNextSummaryClick) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressNextSummaryClick = false;
      details.setAttribute("open", "");
      delete details.dataset.hoverOpen;
    });
  });

  menubars.forEach((menubar) => {
    menubar.addEventListener("pointerenter", clearHoverCloseTimer);
    menubar.addEventListener("pointerleave", () => {
      scheduleHoverClose(menubar.ownerDocument || root);
    });
  });

  root.querySelectorAll(".topMenuNestedWrap").forEach((item) => {
    const trigger = item.querySelector(":scope > .topNestedTrigger");
    item.addEventListener("pointerenter", () => {
      clearHoverCloseTimer();
      openNestedMenu(item, { keepPinned: true });
    });
    item.addEventListener("pointerleave", () => {
      window.setTimeout(() => {
        if (!item.matches(":hover") && item.dataset.submenuPinned !== "true") {
          delete item.dataset.submenuOpen;
        }
      }, 180);
    });
    trigger?.addEventListener("click", (event) => {
      event.preventDefault();
      const pinned = item.dataset.submenuPinned === "true";
      if (pinned) {
        delete item.dataset.submenuPinned;
        delete item.dataset.submenuOpen;
      } else {
        openNestedMenu(item, { pinned: true });
      }
    });
    trigger?.addEventListener("focus", () => {
      openNestedMenu(item, { keepPinned: true });
    });
  });

  if (typeof onOutsidePointerDown === "function") {
    root.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.target.closest(".topMenubar")) {
          clearHoverCloseTimer();
          closeHoverMenus(root);
          closeNestedMenus(root);
          onOutsidePointerDown(event);
        }
      },
      true
    );
  }
}
