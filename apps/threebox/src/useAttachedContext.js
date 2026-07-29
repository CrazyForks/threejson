/**
 * Ported from tools/scene-host/threebox/js/threeBoxAttachedContext.js (structure follows
 * threebox-cloud's useThreeBoxAttachedContext). Owns the "attached scene" preview row above the
 * composer: a template picked from the sidebar gallery, or an uploaded json/tjz/model file, shown
 * as a live mini SceneCard that collapses to a chip. The attached scene is consumed as context for
 * the NEXT message the user sends (App.jsx's send() reads get()); this hook owns only the preview
 * UI state, not the send flow.
 */
import { useCallback, useState } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";

export function useAttachedContext() {
  const [current, setCurrent] = useState(null); // { kind, id, label, sceneJson }
  const [expanded, setExpanded] = useState(true);

  const setTemplate = useCallback((item, sceneJson) => {
    setCurrent({ kind: "template", id: item.id, label: item.title || item.id, sceneJson });
    setExpanded(true);
  }, []);

  const clear = useCallback(() => setCurrent(null), []);
  const collapse = useCallback(() => setExpanded(false), []);
  const expand = useCallback(() => setExpanded(true), []);

  return {
    current,
    expanded,
    setTemplate,
    clear,
    collapse,
    expand,
    get: () => current,
    label: current
      ? t("threebox.attached.willUseAsContext", "将作为上下文：{label}", { label: current.label })
      : ""
  };
}
