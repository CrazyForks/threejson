/**
 * Property inspector for the selected object.
 *
 * Every read is `object.get` and every write is `object.patch`, dispatched through the same command
 * registry the console uses. That is the whole point: the inspector adds no private mutation path,
 * so an edit made here and the identical command typed into the console are indistinguishable.
 *
 * Undo: core mutations apply to the live scene without writing back to the source payload, so each
 * edit brackets the patch — `beginHistoryStep()` snapshots the document before, and
 * `commitRuntimeToDocument()` folds the result back after. Without the commit the document never
 * changes, and redo has no "after" state to restore. Undo reloads the whole scene rather than
 * inverting one property: coarser than the original editor's per-property history, but honest.
 *
 * Kept as app code rather than pushed into @threejson/react-ui: only this app needs it so far, and
 * the extraction rule for these packages is "a second consumer actually exists", not "it looks
 * reusable". Its shape is deliberately close to something extractable if threebox grows an
 * inspector later.
 *
 * Editing model: inputs are local while focused and commit on blur or Enter. Committing per
 * keystroke would fire a command (and a history entry) for every digit typed, including the
 * transient empty string when a field is cleared.
 */
import { useCallback, useEffect, useState } from "react";

const VECTOR_FIELDS = [
  { path: "position", label: "Position", step: 0.1 },
  { path: "rotation", label: "Rotation", step: 0.05 },
  { path: "scale", label: "Scale", step: 0.1 }
];
const AXES = ["x", "y", "z"];

/** Descriptors store vectors as either [x,y,z] or {x,y,z}; read both, write back in kind. */
function readVectorComponent(value, axis, index) {
  if (Array.isArray(value)) {
    return value[index];
  }
  if (value && typeof value === "object") {
    return value[axis];
  }
  return undefined;
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  // Trim float noise (0.30000000000000004) without destroying genuine precision.
  return String(Math.round(value * 1e6) / 1e6);
}

function NumberField({ label, value, step, disabled, onCommit }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  // While focused the field owns its text; otherwise it mirrors the descriptor, so an external
  // change (a console command, an undo) is reflected without clobbering active typing.
  const shown = editing ? draft : formatNumber(value);

  const commit = () => {
    setEditing(false);
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next) || next === value) {
      return;
    }
    onCommit(next);
  };

  return (
    <label className="propField">
      <span className="propAxis">{label}</span>
      <input
        type="number"
        step={step}
        disabled={disabled}
        value={shown}
        onFocus={() => {
          setEditing(true);
          setDraft(formatNumber(value));
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

/** Text field that commits on blur/Enter, so a URL is not re-patched on every keystroke. */
function TextField({ value, disabled, placeholder, onCommit }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : value ?? "";
  const commit = () => {
    setEditing(false);
    if (draft !== (value ?? "")) {
      onCommit(draft);
    }
  };
  return (
    <input
      type="text"
      disabled={disabled}
      placeholder={placeholder}
      value={shown}
      onFocus={() => {
        setEditing(true);
        setDraft(value ?? "");
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Material editor. Every field dispatches `material.patch` for exactly that key, so editing colour
 * never disturbs roughness and vice versa. A missing `material` means the object type carries none
 * (e.g. a group); `type` defaults to "standard" the same way the engine does.
 */
function MaterialPanel({ material, busy, onPatch }) {
  const m = material || {};
  const num = (key, label, { min = 0, max = 1, step = 0.05 } = {}) => (
    <label className="propField" key={key}>
      <span className="propAxis">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={busy}
        value={typeof m[key] === "number" ? m[key] : ""}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) {
            onPatch(key, v);
          }
        }}
      />
    </label>
  );

  return (
    <div className="propGroup">
      <div className="propLabel">Material {m.type ? <span className="propUnset">({m.type})</span> : null}</div>
      <label className="propField">
        <span className="propAxis">Color</span>
        <input
          type="color"
          disabled={busy}
          value={normalizeColor(m.color)}
          onChange={(e) => onPatch("color", e.target.value)}
        />
      </label>
      <div className="propAxes">
        {num("metalness", "Metal")}
        {num("roughness", "Rough")}
        {num("opacity", "Opac")}
      </div>
      <label className="propField propCheck">
        <input
          type="checkbox"
          disabled={busy}
          checked={m.transparent === true}
          onChange={(e) => onPatch("transparent", e.target.checked)}
        />
        <span>Transparent</span>
      </label>
      <label className="propField propWide">
        <span className="propAxis">Texture</span>
        <TextField
          value={m.textureUrl}
          disabled={busy}
          placeholder="https://… or assets/…"
          onCommit={(v) => onPatch("textureUrl", v)}
        />
      </label>
    </div>
  );
}

export function PropertyInspector({ editor, selection, revision, onChanged }) {
  const [descriptor, setDescriptor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { runCommandObject } = editor;

  // `revision` changes whenever the scene reloads or any command runs. Without it the panel only
  // refetches when the *selection* changes, so an undo — or a patch typed into the console — leaves
  // it displaying values the object no longer has, while the scene underneath is already correct.
  const refresh = useCallback(async () => {
    if (!selection) {
      setDescriptor(null);
      setError(null);
      return;
    }
    const result = await runCommandObject("object.get", { id: selection }, { quiet: true });
    if (result?.ok === false) {
      setDescriptor(null);
      setError(result?.error || "Could not read this object.");
      return;
    }
    setError(null);
    // object.get answers { threeJsonId, path, value } — the descriptor is `value`, not `data`
    // itself, so that a path-scoped read (`object.get id=X path=position`) has somewhere to put it.
    setDescriptor(result?.data?.value ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, runCommandObject, revision]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Both edit paths share one history bracket: snapshot the document, run the command, and only on
  // success fold the result back in. `op` is object.patch for transforms and material.patch for
  // material fields — material.patch exists precisely so a material edit does not have to hand-build
  // a `{ material: { … } }` object.patch partial and risk clobbering sibling fields.
  const runEdit = useCallback(
    async (op, args) => {
      if (!selection) {
        return;
      }
      setBusy(true);
      editor.beginHistoryStep();
      const result = await runCommandObject(op, { id: selection, ...args });
      setBusy(false);
      if (result?.ok === false) {
        setError(result?.error || "Edit failed.");
        return;
      }
      await editor.commitRuntimeToDocument();
      setError(null);
      await refresh();
      onChanged?.();
    },
    [selection, runCommandObject, refresh, onChanged, editor]
  );

  const patch = useCallback(
    (partialOrPath, value) =>
      runEdit(
        "object.patch",
        typeof partialOrPath === "string" ? { path: partialOrPath, value } : { partial: partialOrPath }
      ),
    [runEdit]
  );

  /** One material field at a time, so an edit never carries stale copies of the others. */
  const patchMaterial = useCallback(
    (field, value) => runEdit("material.patch", { partial: { [field]: value } }),
    [runEdit]
  );

  if (!selection) {
    return <div className="hint">Select an object to inspect its properties.</div>;
  }
  if (error && !descriptor) {
    return <div className="hint err">{error}</div>;
  }
  if (!descriptor) {
    return <div className="hint">Reading…</div>;
  }

  return (
    <div className="inspector">
      <div className="propRow">
        <span className="propLabel">Name</span>
        <span className="propValue" title={descriptor.name || ""}>
          {descriptor.label || descriptor.name || "—"}
        </span>
      </div>
      <div className="propRow">
        <span className="propLabel">Type</span>
        <span className="propValue">{descriptor.objType || "—"}</span>
      </div>
      <div className="propRow">
        <span className="propLabel">Id</span>
        <span className="propValue mono" title={selection}>
          {selection}
        </span>
      </div>

      <label className="propRow">
        <span className="propLabel">Visible</span>
        <input
          type="checkbox"
          disabled={busy}
          checked={descriptor.visible !== false}
          onChange={(e) => void patch("visible", e.target.checked)}
        />
      </label>

      {VECTOR_FIELDS.map((field) => {
        const raw = descriptor[field.path];
        return (
          <div className="propGroup" key={field.path}>
            <div className="propLabel">
              {field.label}
              {raw === undefined ? <span className="propUnset"> (unset)</span> : null}
            </div>
            <div className="propAxes">
              {AXES.map((axis, index) => (
                <NumberField
                  key={axis}
                  label={axis.toUpperCase()}
                  step={field.step}
                  disabled={busy}
                  value={readVectorComponent(raw, axis, index)}
                  onCommit={(next) =>
                    // Dot-path writes work for both storage shapes: applyObjectChange resolves
                    // `position.x` against an array as index 0 as well as against an object key.
                    void patch(`${field.path}.${axis}`, next)
                  }
                />
              ))}
            </div>
          </div>
        );
      })}

      {descriptor.material ? (
        <MaterialPanel material={descriptor.material} busy={busy} onPatch={patchMaterial} />
      ) : null}

      {error ? <div className="hint err">{error}</div> : null}
    </div>
  );
}

/** <input type="color"> requires #rrggbb; descriptors may carry a number or a shorthand string. */
function normalizeColor(color) {
  if (typeof color === "number") {
    return `#${color.toString(16).padStart(6, "0")}`;
  }
  const text = String(color || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text;
  }
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  return "#ffffff";
}
