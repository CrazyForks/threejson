/**
 * Schema-driven settings modal, ported from tools/scene-host/editor/js/settingsModal.js. The
 * schema/store are already packaged (@threejson/host-kit's editorSettingsSchema.js /
 * editorSettingsStore.js — 11 sections), so this file is UI only: nav + a generic field loop per
 * section, following the same pattern already validated in apps/threebox's SettingsModal.jsx.
 *
 * The "ai" section's provider-list editing (add/delete provider cards, the built-in-provider card)
 * is not built here — it has no consumer until phase 7 adds the AI panels that would use it. Its
 * plain fields (agent behavior, defaults) render through the generic loop like every other
 * section; a note explains the gap rather than a silently missing feature.
 */
import { useState } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";
import { probeEndpoint } from "@threejson/host-kit/js/endpointProbe.js";
import {
  EDITOR_SETTINGS_SECTIONS,
  EDITOR_SETTINGS_FIELDS,
  cloneEditorSettings,
  getSettingsByPath,
  setSettingsByPath,
  getEditorSettings,
  setEditorSettings,
  useEditorSettings
} from "./lib/useEditorSettings.js";

function fieldsForSection(sectionId) {
  return EDITOR_SETTINGS_FIELDS.filter((f) => f.section === sectionId);
}

function GenericField({ field, draft, onChange }) {
  const value = getSettingsByPath(draft, field.path);
  const [testState, setTestState] = useState("idle");
  const [testMessage, setTestMessage] = useState("");

  async function runTest(currentValue) {
    if (!field.testEndpoint) {
      return;
    }
    setTestState("testing");
    try {
      const result = await probeEndpoint(currentValue, "/health");
      setTestState(result.ok ? "success" : "failed");
      setTestMessage(result.ok ? "" : result.message || "unreachable");
    } catch (error) {
      setTestState("failed");
      setTestMessage(error?.message || "unreachable");
    } finally {
      setTimeout(() => setTestState("idle"), 2200);
    }
  }

  let control;
  if (field.type === "checkbox") {
    control = (
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(field.path, e.target.checked)} />
    );
  } else if (field.type === "select") {
    control = (
      <select value={value ?? ""} onChange={(e) => onChange(field.path, e.target.value)}>
        {(field.options || []).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "number") {
    control = (
      <input
        type="number"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value ?? 0}
        onChange={(e) => onChange(field.path, Number(e.target.value))}
      />
    );
  } else if (field.type === "color") {
    control = (
      <input
        type="color"
        value={typeof value === "string" && value ? value : "#ffffff"}
        onChange={(e) => onChange(field.path, e.target.value)}
      />
    );
  } else if (field.type === "textarea") {
    control = (
      <textarea
        rows={field.rows || 3}
        placeholder={field.placeholder || ""}
        value={value ?? ""}
        onChange={(e) => onChange(field.path, e.target.value)}
      />
    );
  } else {
    control = (
      <input
        type="text"
        placeholder={field.placeholder || ""}
        value={value ?? ""}
        onChange={(e) => onChange(field.path, e.target.value)}
      />
    );
  }

  const testLabel =
    testState === "testing"
      ? "测试中…"
      : testState === "success"
        ? "已连接"
        : testState === "failed"
          ? `失败：${testMessage || "无法连接"}`
          : "测试";

  const isCheckbox = field.type === "checkbox";
  const fieldClass = [
    "editorSettingsField",
    isCheckbox ? "editorSettingsFieldCheck" : "",
    field.hint ? "editorSettingsFieldWithHint" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (isCheckbox) {
    return (
      <div className={fieldClass}>
        <label>
          {control}
          <span>{field.label}</span>
        </label>
        {field.hint && <div className="editorSettingsHint">{field.hint}</div>}
      </div>
    );
  }

  return (
    <div className={fieldClass}>
      <label>{field.label}</label>
      {field.testEndpoint ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{control}</div>
          <button
            type="button"
            className="miniBtn"
            disabled={testState === "testing"}
            onClick={() => void runTest(String(value ?? "").trim())}
          >
            {testLabel}
          </button>
        </div>
      ) : (
        control
      )}
      {field.hint && <div className="editorSettingsHint">{field.hint}</div>}
    </div>
  );
}

export function SettingsModal({ initialSectionId = "general", onClose, showToast }) {
  // Subscribe so an external settings change reflows this modal while open.
  useEditorSettings();
  const [draft, setDraft] = useState(() => cloneEditorSettings(getEditorSettings()));
  const [activeSectionId, setActiveSectionId] = useState(
    EDITOR_SETTINGS_SECTIONS.some((s) => s.id === initialSectionId) ? initialSectionId : "general"
  );

  function handleFieldChange(path, value) {
    setDraft((prev) => {
      const next = cloneEditorSettings(prev);
      setSettingsByPath(next, path, value);
      return next;
    });
  }

  function handleSave() {
    setEditorSettings(draft);
    showToast?.("设置已保存。", "success");
    onClose();
  }

  return (
    <div
      id="editorSettingsModal"
      className="visible"
      role="dialog"
      aria-modal="true"
      aria-label="编辑器设置"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="editorSettingsDialog">
        <div className="editorSettingsHeader">编辑器设置</div>
        <div className="editorSettingsBody">
          <nav className="editorSettingsNav">
            {EDITOR_SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`editorSettingsNavBtn${section.id === activeSectionId ? " active" : ""}`}
                onClick={() => setActiveSectionId(section.id)}
              >
                {t(`editor.settings.section.${section.id}`, section.title)}
              </button>
            ))}
          </nav>
          <div className="editorSettingsScroll">
            {activeSectionId === "ai" && (
              <p className="sceneManageHint">
                供应商管理（添加/删除模型供应商、内置试用额度）将在阶段 7 随 AI 面板一起提供；下方是已可用的行为类设置。
              </p>
            )}
            {fieldsForSection(activeSectionId).map((field) => (
              <GenericField key={field.path} field={field} draft={draft} onChange={handleFieldChange} />
            ))}
          </div>
        </div>
        <div className="editorSettingsFooter">
          <button type="button" className="miniBtn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="miniBtn primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
