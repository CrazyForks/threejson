import { getAllResources, deleteResource } from "./threeBoxSessionStore.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t } from "../../shared/i18n/index.js";

const KIND_ICON = {
  json: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M3 2h7l3 3v9H3z"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="M6 8.5h4M6 10.8h4"/></svg>',
  tjz: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2.5" y="3" width="11" height="10" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.2"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="M8 3v10"/></svg>',
  model: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" d="M8 2 14 5.5v5L8 14 2 10.5v-5z"/><path fill="none" stroke="currentColor" stroke-width="1" d="M2 5.5 8 9l6-3.5M8 9v5"/></svg>',
  image: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="2" y="3" width="12" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.6" cy="6.6" r="1.1" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="m3 11.5 3.3-3.3 2.3 2.1L12.5 7 14 8.5"/></svg>',
  other: '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M4 2h5l3 3v9H4z"/></svg>'
};

/**
 * Sidebar "资源库" section: lists every file the user has uploaded via the composer's attach
 * menu (threeBoxComposerStub.js), grouped by kind with a category-tab filter. Clicking an
 * auto-loadable resource (json/tjz/model — anything with a cached `sceneJson`) attaches it as
 * the composer's next-message context, identically to clicking a template gallery card.
 * @param {{ attachedContext?: object }} [host]
 */
export function createThreeBoxResourceLibrary(host = {}) {
  const listEl = document.getElementById("resourceList");
  const tabsEl = document.getElementById("resourceCategoryTabs");

  let resources = [];
  let activeCategory = "all";

  function formatSize(resource) {
    if (resource.blob?.size) {
      const kb = resource.blob.size / 1024;
      return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
    }
    if (resource.sceneJson) {
      const kb = resource.sceneJson.length / 1024;
      return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
    }
    return "";
  }

  function render() {
    if (!listEl) {
      return;
    }
    listEl.innerHTML = "";
    const filtered = activeCategory === "all" ? resources : resources.filter((r) => r.kind === activeCategory);
    if (!filtered.length) {
      const hint = document.createElement("div");
      hint.className = "sidebarStubHint";
      hint.textContent = t("threebox.resource.empty", "暂无资源，点击输入框旁的「+」上传。");
      listEl.appendChild(hint);
      return;
    }
    for (const resource of filtered) {
      const item = document.createElement("div");
      item.className = "resourceItem";

      const icon = document.createElement("span");
      icon.className = "resourceItemIcon";
      icon.innerHTML = KIND_ICON[resource.kind] || KIND_ICON.other;
      item.appendChild(icon);

      const info = document.createElement("div");
      info.className = "resourceItemInfo";
      const name = document.createElement("div");
      name.className = "resourceItemName";
      name.textContent = resource.name;
      name.title = resource.name;
      const meta = document.createElement("div");
      meta.className = "resourceItemMeta";
      meta.textContent = formatSize(resource);
      info.appendChild(name);
      info.appendChild(meta);
      item.appendChild(info);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "resourceItemRemoveBtn";
      removeBtn.title = t("threebox.resource.remove", "删除");
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", async (event) => {
        event.stopPropagation();
        await deleteResource(resource.id);
        await refresh();
      });
      item.appendChild(removeBtn);

      if (resource.sceneJson) {
        item.classList.add("resourceItemLoadable");
        item.addEventListener("click", () => {
          if (!host.attachedContext) {
            return;
          }
          host.attachedContext.setTemplate({ id: resource.id, title: resource.name }, JSON.parse(resource.sceneJson));
          showToast(t("threebox.composer.loadedAsContext", "已加载「{name}」作为上下文。", { name: resource.name }), "success");
        });
      } else {
        item.title = t("threebox.resource.notLoadable", "该类型暂不支持直接加载为场景上下文");
      }

      listEl.appendChild(item);
    }
  }

  async function refresh() {
    resources = await getAllResources().catch(() => []);
    render();
  }

  function init() {
    tabsEl?.querySelectorAll(".resourceCategoryTab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeCategory = tab.dataset.category || "all";
        tabsEl.querySelectorAll(".resourceCategoryTab").forEach((t) => t.classList.toggle("active", t === tab));
        render();
      });
    });
    void refresh();
  }

  return { init, refresh };
}
