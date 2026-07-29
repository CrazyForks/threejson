/**
 * Shower-local label table.
 *
 * The shared @threejson/host-kit i18n catalogs cover the editor / player / threebox shells but have
 * no `shower.*` keys, and host-kit's `t()` falls back to the *English* literal for a missing key
 * regardless of locale — which would leave a zh-CN user reading English. So, like the original
 * tools/scene-host/shower, this app owns its own small table and uses @threejson/react's
 * useHostI18n() purely for the resolved locale.
 */
const LABELS = {
  "zh-CN": {
    catalog: "示例目录",
    run: "运行",
    autoRun: "实时渲染",
    format: "格式化",
    friendly: "友好",
    standard: "标准",
    fit: "自适应",
    exportHtml: "导出 HTML",
    exportJson: "导出 JSON",
    exportModel: "导出模型",
    openInEditor: "在编辑器中打开",
    editorOpened: "已将场景发送到编辑器。",
    editorOpenFailed: "发送场景到编辑器失败：",
    loading: "加载中…",
    empty: "从左侧选择一个示例，或直接编辑 JSON 后点击「运行」。",
    parseFailed: "JSON 解析失败：",
    alreadyFriendly: "当前已经是友好 JSON。",
    alreadyStandard: "当前已经是标准 JSON。",
    exported: "模板已导出。",
    exportedJson: "原生 JSON 已导出。",
    dismiss: "关闭",
    language: "语言"
  },
  "en-US": {
    catalog: "Examples",
    run: "Run",
    autoRun: "Live render",
    format: "Format",
    friendly: "Friendly",
    standard: "Standard",
    fit: "Fit view",
    exportHtml: "Export HTML",
    exportJson: "Export JSON",
    exportModel: "Export model",
    openInEditor: "Open in editor",
    editorOpened: "Scene sent to the editor.",
    editorOpenFailed: "Could not send the scene to the editor: ",
    loading: "Loading…",
    empty: "Pick an example on the left, or edit the JSON and press Run.",
    parseFailed: "JSON parse failed: ",
    alreadyFriendly: "Already friendly JSON.",
    alreadyStandard: "Already standard JSON.",
    exported: "Template exported.",
    exportedJson: "Native JSON exported.",
    dismiss: "Dismiss",
    language: "Language"
  }
};

export function labelsFor(locale) {
  return LABELS[locale] || LABELS["en-US"];
}

/** Manifest entries carry both `title`/`desc` (zh) and `titleEn`/`descEn`. */
export function localizedField(item, field, locale) {
  if (locale === "en-US") {
    const en = item[`${field}En`];
    if (en) {
      return en;
    }
  }
  return item[field] || "";
}
