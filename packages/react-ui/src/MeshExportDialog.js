/**
 * Mesh export dialog — format picker, export progress, and the post-export warnings report.
 *
 * Extracted once a second app needed it (scene-player and scene-shower); the export logic itself
 * already lived in @threejson/host-kit's meshExport, so this is purely the UI half.
 *
 * Authored with `createElement` rather than JSX, like @threejson/react: these packages ship raw ESM
 * with no build step, so the source must stay valid JavaScript as written. Consumers still write
 * `<MeshExportDialog />`.
 *
 * Styling: this component only emits class names (`tjUi-*`), so it inherits your app's look if you
 * define them, or you can import the bundled sheet:
 *   import "@threejson/react-ui/styles.css";
 */
import { createElement as h, useState } from "react";
import { useHostI18n } from "@threejson/react/i18n";
import { MESH_EXPORT_FORMATS, exportSceneMeshToFile } from "@threejson/host-kit/js/meshExport.js";

/**
 * @param {object} props
 * @param {() => ({ scene: any, renderer: any, currentLabel?: string } | null)} props.getSceneSnapshot
 *   returns the live scene + renderer at export time (e.g. useScenePlayer's getSnapshot).
 * @param {() => void} props.onClose
 * @param {(detail: { fileName: string, warnings: string[] }) => void} [props.onExported]
 */
export function MeshExportDialog({ getSceneSnapshot, onClose, onExported }) {
  const { t } = useHostI18n();
  const [format, setFormat] = useState("glb");
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState(null);
  const [error, setError] = useState(null);

  async function runExport() {
    const snapshot = getSceneSnapshot?.();
    if (!snapshot?.scene?.isScene) {
      setError(t("threebox.sceneCard.modelNotReady", "The scene has not finished rendering yet."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await exportSceneMeshToFile(snapshot.scene, {
        format,
        renderer: snapshot.renderer,
        fileNameStem: snapshot.currentLabel || "scene"
      });
      onExported?.(result);
      // Warnings mean the file downloaded but lost something in conversion — worth a look before
      // the user ships it, so the dialog stays open on a report screen instead of closing silently.
      if (result.warnings.length) {
        setWarnings(result.warnings);
      } else {
        onClose?.();
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  if (warnings) {
    return h(
      "div",
      { className: "tjUi-overlay", role: "alertdialog", "aria-modal": "true" },
      h(
        "div",
        { className: "tjUi-dialog" },
        h("h2", { className: "tjUi-dialogTitle" }, t("threebox.meshExport.warningTitle", "Exported, with caveats")),
        h(
          "div",
          { className: "tjUi-dialogBody" },
          h(
            "p",
            null,
            t(
              "threebox.meshExport.warningIntro",
              "The file downloaded. These resources could not be written in full — check them before shipping it:"
            )
          ),
          h(
            "ul",
            { className: "tjUi-warningList" },
            warnings.map((w, i) => h("li", { key: i }, w))
          )
        ),
        h(
          "div",
          { className: "tjUi-dialogFooter" },
          h(
            "button",
            { type: "button", className: "tjUi-primary", onClick: onClose },
            t("threebox.meshExport.warningDismiss", "Got it")
          )
        )
      )
    );
  }

  return h(
    "div",
    {
      className: "tjUi-overlay",
      role: "dialog",
      "aria-modal": "true",
      onClick: (event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose?.();
        }
      }
    },
    h(
      "div",
      { className: "tjUi-dialog" },
      h("h2", { className: "tjUi-dialogTitle" }, t("threebox.meshExport.title", "Export third-party model")),
      h(
        "div",
        { className: "tjUi-dialogBody" },
        h(
          "div",
          { className: "tjUi-field" },
          h("label", { htmlFor: "tjUi-meshFormat" }, t("threebox.meshExport.format", "Format")),
          h(
            "select",
            {
              id: "tjUi-meshFormat",
              value: format,
              disabled: busy,
              onChange: (event) => setFormat(event.target.value)
            },
            MESH_EXPORT_FORMATS.map((entry) =>
              h("option", { key: entry.value, value: entry.value }, t(entry.labelKey, entry.fallback))
            )
          )
        ),
        h(
          "p",
          { className: "tjUi-muted" },
          t(
            "threebox.meshExport.hint",
            "OBJ/STL/PLY export geometry mainly; USDZ suits iOS AR preview. Prefer GLB for texture-rich scenes."
          )
        ),
        error ? h("p", { className: "tjUi-error" }, error) : null
      ),
      h(
        "div",
        { className: "tjUi-dialogFooter" },
        h("button", { type: "button", onClick: onClose, disabled: busy }, t("threebox.meshExport.cancel", "Cancel")),
        h(
          "button",
          { type: "button", className: "tjUi-primary", onClick: () => void runExport(), disabled: busy },
          busy
            ? t("threebox.sceneCard.exportMeshStarted", "Exporting…")
            : t("threebox.meshExport.confirm", "Export")
        )
      )
    )
  );
}
