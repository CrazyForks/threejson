/**
 * Scene-tree panel — a collapsible outline of the live scene graph with selection.
 *
 * The tree *model* (which objects to hide, how to find one again) lives in
 * @threejson/host-kit's sceneTreeModel; this is only the rendering half, the same split as
 * MeshExportDialog / meshExport.
 *
 * Authored with `createElement` rather than JSX — these packages ship raw ESM with no build step.
 */
import { createElement as h, useCallback, useMemo, useState } from "react";
import { useHostI18n } from "@threejson/react/i18n";
import { buildSceneTreeModel, countSceneTreeNodes } from "@threejson/host-kit/js/sceneTreeModel.js";

/** Stable per-row key: authored id when present, uuid otherwise. */
function rowKey(node) {
  return node.threeJsonId || node.uuid;
}

function TreeRow({ node, depth, selectedKey, expanded, onToggle, onSelect, t }) {
  const key = rowKey(node);
  const hasChildren = node.children.length > 0;
  // Default to expanded: a collapsed-by-default outline hides the content the panel exists to show.
  const isOpen = expanded[key] !== false;
  const isSelected = selectedKey === key;

  return h(
    "div",
    { className: "tjUi-treeRowGroup" },
    h(
      "div",
      {
        className: `tjUi-treeRow${isSelected ? " tjUi-treeRowSelected" : ""}`,
        style: { paddingLeft: `${depth * 14 + 6}px` }
      },
      h(
        "button",
        {
          type: "button",
          className: "tjUi-treeTwisty",
          // Keep the row's text aligned across siblings whether or not they have children.
          style: hasChildren ? undefined : { visibility: "hidden" },
          "aria-label": isOpen ? t("editor.sceneTree.collapse", "Collapse") : t("editor.sceneTree.expand", "Expand"),
          "aria-expanded": hasChildren ? isOpen : undefined,
          onClick: () => onToggle(key)
        },
        isOpen ? "▾" : "▸"
      ),
      h(
        "button",
        {
          type: "button",
          className: "tjUi-treeLabel",
          "aria-current": isSelected ? "true" : undefined,
          title: node.threeJsonId || node.name || node.type,
          onClick: () => onSelect(node)
        },
        h("span", { className: "tjUi-treeName" }, node.name || node.threeJsonId || `(${node.type})`),
        h("span", { className: "tjUi-treeType" }, node.type),
        node.visible ? null : h("span", { className: "tjUi-treeHidden" }, t("editor.sceneTree.hidden", "hidden"))
      )
    ),
    hasChildren && isOpen
      ? h(
          "div",
          { className: "tjUi-treeChildren", role: "group" },
          node.children.map((child) =>
            h(TreeRow, {
              key: rowKey(child),
              node: child,
              depth: depth + 1,
              selectedKey,
              expanded,
              onToggle,
              onSelect,
              t
            })
          )
        )
      : null
  );
}

/**
 * @param {object} props
 * @param {any} props.scene live THREE.Scene / Object3D root (null before a scene loads).
 * @param {(node: object) => void} [props.onSelect] receives the tree node; `node.object` is live.
 * @param {string} [props.selectedKey] threeJsonId (or uuid) of the selected row — controlled.
 * @param {any[]} [props.extraRuntimeObjects] app-owned gizmos to hide (see sceneTreeModel).
 * @param {boolean} [props.hideLights=true]
 * @param {number} [props.revision] bump to rebuild after mutating the scene graph — the graph is
 *   mutable and React cannot observe it, so this is how a host signals "the tree changed".
 */
export function SceneTreePanel({
  scene,
  onSelect,
  selectedKey,
  extraRuntimeObjects,
  hideLights = true,
  revision = 0
}) {
  const { t } = useHostI18n();
  const [expanded, setExpanded] = useState({});

  const nodes = useMemo(
    () => buildSceneTreeModel(scene, { extraRuntimeObjects, hideLights }),
    // `revision` is the explicit invalidation signal; mutating a scene in place changes neither the
    // `scene` reference nor anything else React can see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, revision, hideLights, extraRuntimeObjects]
  );

  const handleToggle = useCallback((key) => {
    setExpanded((prev) => ({ ...prev, [key]: prev[key] === false }));
  }, []);

  const handleSelect = useCallback(
    (node) => {
      onSelect?.(node);
    },
    [onSelect]
  );

  if (!nodes.length) {
    return h(
      "div",
      { className: "tjUi-treePanel tjUi-treeEmpty" },
      t("editor.sceneTree.empty", "No objects in this scene.")
    );
  }

  return h(
    "div",
    { className: "tjUi-treePanel", role: "tree", "aria-label": t("editor.sceneTree.title", "Scene tree") },
    h(
      "div",
      { className: "tjUi-treeCount" },
      t("editor.sceneTree.count", "{count} objects", { count: countSceneTreeNodes(nodes) })
    ),
    nodes.map((node) =>
      h(TreeRow, {
        key: rowKey(node),
        node,
        depth: 0,
        selectedKey,
        expanded,
        onToggle: handleToggle,
        onSelect: handleSelect,
        t
      })
    )
  );
}
