/**
 * Collapsible, syntax-highlighted code view for an assistant turn's result, ported from the
 * original tools/scene-host/threebox/js/threeBoxChatPanel.js (buildJsonCollapse / buildDiffCollapse
 * / highlightJsonLine / the copy-button + line-number/highlight DOM). No @threejson/* package
 * exposes the chat panel, so the app carries this.
 *
 * Two variants share the same chrome:
 *   • "查看生成的 JSON" — the scene JSON produced by a generate/adjust turn (kept out of the
 *     markdown recap because it can be very long).
 *   • "查看调整命令" / "查看调整的 JSON Patch" — the raw operation commands or RFC-6902 patch an
 *     adjust turn applied, so the user sees what the model actually changed.
 *
 * Faithful differences from the vanilla version: React renders the highlighted lines on first open
 * (a lazy `mounted` flag) rather than the vanilla idle-chunk upgrade — simpler, and scenes here are
 * a few KB. The highlighter escapes HTML before tokenizing, so the per-line innerHTML is safe.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { projectSceneJsonString } from "threejson/ai";
import { t } from "@threejson/host-kit/i18n/index.js";

const COPY_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path fill="none" stroke="currentColor" strokeWidth="1.2" d="M3.5 10.5v-6a1 1 0 0 1 1-1h6" />
  </svg>
);
const CHECK_ICON = (
  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.5 8.5 6.5 11.5 12.5 4.5"
    />
  </svg>
);

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Port of the original highlightJsonLine: escape, then tag strings/keys/literals/numbers. */
function highlightJsonLine(line) {
  return escapeHtml(line).replace(
    /(&quot;(?:\\.|[^"\\])*&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match, stringToken, colon, keyword) => {
      if (stringToken) {
        return colon
          ? `<span class="jsonTokenKey">${stringToken}</span>${colon}`
          : `<span class="jsonTokenString">${stringToken}</span>`;
      }
      if (keyword) {
        return `<span class="jsonTokenLiteral">${match}</span>`;
      }
      return `<span class="jsonTokenNumber">${match}</span>`;
    }
  );
}

/**
 * @param {object}  props
 * @param {string}  props.text     text to display and copy (pretty-printed JSON / commands)
 * @param {string}  props.label    summary label (e.g. "查看生成的 JSON")
 * @param {string}  props.copyTitle copy-button tooltip
 * @param {boolean} [props.diff]   render as the diff variant (adds the diffCollapse class)
 * @param {boolean} [props.lineNumbers] show the line-number gutter (io.jsonViewerLineNumbers)
 * @param {boolean} [props.highlight]   syntax-highlight the code (io.jsonViewerHighlight)
 */
export function JsonCollapse({ text, label, copyTitle, diff = false, lineNumbers = true, highlight = true }) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);
  const revertTimer = useRef(null);

  const onToggle = useCallback((event) => {
    if (event.currentTarget.open) {
      setMounted(true);
    }
  }, []);

  const onCopy = useCallback(
    async (event) => {
      // The copy button lives inside <summary>; stop the click from also toggling the details.
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      setCopied(true);
      clearTimeout(revertTimer.current);
      revertTimer.current = setTimeout(() => setCopied(false), 1400);
    },
    [text]
  );

  const lines = String(text ?? "").split(/\r?\n/);

  return (
    <details className={`jsonCollapse${diff ? " diffCollapse" : ""}`} onToggle={onToggle}>
      <summary>
        <span className="jsonCollapseSummaryText">{label}</span>
        <button
          type="button"
          className={`jsonCollapseCopyBtn${copied ? " copied" : ""}`}
          title={copyTitle}
          onClick={onCopy}
        >
          {copied ? CHECK_ICON : COPY_ICON}
        </button>
      </summary>
      {mounted && (
        <pre
          className={`jsonCodeView${lineNumbers ? " jsonCodeViewLineNumbers" : ""}${
            highlight ? " jsonCodeViewHighlighted" : ""
          }`}
        >
          <code className="jsonCodeLines">
            {lines.map((line, i) => (
              <span className="jsonCodeLine" key={i}>
                {lineNumbers && <span className="jsonCodeLineNumber">{i + 1}</span>}
                {highlight ? (
                  <span
                    className="jsonCodeLineContent"
                    dangerouslySetInnerHTML={{ __html: highlightJsonLine(line) }}
                  />
                ) : (
                  <span className="jsonCodeLineContent">{line}</span>
                )}
              </span>
            ))}
          </code>
        </pre>
      )}
    </details>
  );
}

/**
 * Collapsible view of a turn's final scene JSON ("查看生成的 JSON"). The displayed JSON is projected
 * per io.sceneJsonFormat ("standard" raw vs "friendly" human-readable) via core's
 * projectSceneJsonString, exactly like the original's projectSceneForUser.
 */
export function SceneJsonCollapse({ rawJsonString, format = "standard", lineNumbers = true, highlight = true }) {
  const text = useMemo(() => {
    try {
      return projectSceneJsonString(rawJsonString, format === "friendly" ? "friendly" : "standard");
    } catch {
      try {
        return JSON.stringify(JSON.parse(rawJsonString), null, 2);
      } catch {
        return String(rawJsonString ?? "");
      }
    }
  }, [rawJsonString, format]);

  return (
    <JsonCollapse
      text={text}
      label={t("threebox.chat.viewGeneratedJson", "查看生成的 JSON")}
      copyTitle={t("threebox.chat.copyJson", "复制 JSON")}
      lineNumbers={lineNumbers}
      highlight={highlight}
    />
  );
}

/**
 * Collapsible view of an adjust turn's raw output — operation commands or an RFC-6902 patch
 * ("查看调整命令" / "查看调整的 JSON Patch").
 * @param {"commands"|"patch"} kind
 */
export function AdjustDiffCollapse({ kind, text, lineNumbers = true, highlight = true }) {
  const isPatch = kind === "patch";
  return (
    <JsonCollapse
      diff
      text={text}
      lineNumbers={lineNumbers}
      highlight={highlight}
      label={
        isPatch
          ? t("threebox.chat.viewAdjustPatch", "查看调整的 JSON Patch")
          : t("threebox.chat.viewAdjustCommands", "查看调整命令")
      }
      copyTitle={
        isPatch
          ? t("threebox.chat.copyAdjustPatch", "复制 JSON Patch")
          : t("threebox.chat.copyAdjustCommands", "复制调整命令")
      }
    />
  );
}
