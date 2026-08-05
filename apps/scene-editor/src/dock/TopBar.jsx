/**
 * Top chrome: title bar + menubar, ported from tools/scene-host/editor/_shell-body.html's
 * <header class="topBar">. Structural fidelity is the point of this phase — every original menu is
 * present — but only items this app can actually perform are wired; the rest are disabled with a
 * title naming the phase that lands them, rather than faking functionality.
 */
import { useCallback, useState } from "react";

function Menu({ label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="topMenu" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      <div className="topDropdown" onClick={() => setOpen(false)}>
        {children}
      </div>
    </details>
  );
}

function MenuItem({ children, disabled, title, onClick }) {
  return (
    <button type="button" disabled={disabled} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Nested flyout inside a top-level Menu, matching editor-base.css's .topMenuNestedWrap pattern.
 * The trigger stops click propagation so opening it doesn't also bubble up and close an ancestor
 * Menu/SubMenu's own click-to-close handler; item clicks inside still bubble and close everything,
 * which is the wanted behavior (pick an action, the whole menu tree collapses).
 */
function SubMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="topMenuNestedWrap" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="topNestedTrigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {label}
      </button>
      {open && (
        <div className="topDropdown topDropdownNested" role="menu" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  sceneTitle,
  sceneUrl,
  onSceneUrlChange,
  onLoadUrl,
  editor,
  player,
  gizmoMode,
  onGizmoModeChange,
  selectedObject,
  dockChrome,
  onOpenSettings,
  onImportJson,
  onImportTjz,
  onExportThreeJson,
  onExportNativeJson,
  onExportTjz,
  onExportGlbScene,
  onExportGlbSelection,
  onOpenMeshExportDialog
}) {
  const { pinned, togglePinned } = dockChrome;
  const [fullscreen, setFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setFullscreen(false);
    }
  }, []);

  return (
    <div className="topChromeWrap" id="topChromeWrap">
      <div className="chromePeekStrip chromePeekStripTop" aria-hidden="true" />
      <header className="topBar">
        <div className="appIconSlot" title="Scene Editor" aria-hidden="true">
          ◆
        </div>
        <nav className="topMenubar" aria-label="主菜单">
          <Menu label="文件">
            <MenuItem disabled title="阶段 5 提供">
              新建
            </MenuItem>
            <MenuItem
              title="从 URL 加载场景（开发用，非原版菜单项）"
              onClick={() => {
                const url = window.prompt("场景 JSON 的 URL", sceneUrl);
                if (url) {
                  onSceneUrlChange(url);
                  onLoadUrl(url);
                }
              }}
            >
              打开
            </MenuItem>
            <MenuItem disabled title="阶段 5 提供">
              保存场景
            </MenuItem>
            <MenuItem disabled title="阶段 5 提供">
              另存为
            </MenuItem>
            <MenuItem disabled title="阶段 5 提供">
              打开最近场景
            </MenuItem>
            <SubMenu label="导入">
              <MenuItem onClick={onImportJson}>导入 ThreeJSON</MenuItem>
              <MenuItem disabled title="阶段 5 提供">
                导入原生 JSON
              </MenuItem>
              <MenuItem onClick={onImportTjz}>导入 .tjz 包</MenuItem>
              <hr className="topMenuDivider" />
              <MenuItem disabled title="阶段 9 提供">
                导入 3D 模型…
              </MenuItem>
            </SubMenu>
            <SubMenu label="导出">
              <MenuItem disabled={!player.hasScene} onClick={onExportThreeJson}>
                导出 ThreeJSON
              </MenuItem>
              <MenuItem disabled={!player.hasScene} onClick={onExportNativeJson}>
                导出原生 JSON
              </MenuItem>
              <MenuItem disabled={!player.hasScene} onClick={onExportTjz}>
                导出 .tjz 包
              </MenuItem>
              <hr className="topMenuDivider" />
              <SubMenu label="3D 模型">
                <MenuItem disabled={!player.hasScene} onClick={onExportGlbScene}>
                  GLB（整场景）
                </MenuItem>
                <MenuItem disabled={!selectedObject} onClick={onExportGlbSelection}>
                  GLB（选中对象）
                </MenuItem>
                <MenuItem disabled={!player.hasScene} onClick={onOpenMeshExportDialog}>
                  更多格式…
                </MenuItem>
              </SubMenu>
              <MenuItem disabled title="阶段 5 提供">
                模板…
              </MenuItem>
            </SubMenu>
          </Menu>
          <Menu label="编辑">
            <MenuItem disabled={!editor.canUndo} onClick={() => void editor.runCommand("editor.history.undo")}>
              撤销
            </MenuItem>
            <MenuItem disabled={!editor.canRedo} onClick={() => void editor.runCommand("editor.history.redo")}>
              重做
            </MenuItem>
            <MenuItem disabled title="阶段 4 提供">
              重置
            </MenuItem>
            <MenuItem disabled={!selectedObject} onClick={() => onGizmoModeChange("translate")}>
              移动
            </MenuItem>
            <MenuItem disabled={!selectedObject} onClick={() => onGizmoModeChange("rotate")}>
              旋转
            </MenuItem>
            <MenuItem disabled={!selectedObject} onClick={() => onGizmoModeChange("scale")}>
              缩放
            </MenuItem>
            <MenuItem disabled title="阶段 5 提供">
              截图
            </MenuItem>
            <MenuItem disabled title="尚未提供">
              静音
            </MenuItem>
            <MenuItem disabled title="阶段 8 提供">
              编辑 JSON
            </MenuItem>
          </Menu>
          <Menu label="查看">
            <MenuItem disabled title="阶段 5 提供">
              预览场景JSON
            </MenuItem>
            <MenuItem disabled={!player.hasScene} onClick={() => void editor.runCommand("editor.view.fit")}>
              自适应
            </MenuItem>
            <MenuItem disabled title="阶段 8 提供">
              代码编辑模式
            </MenuItem>
            <MenuItem onClick={toggleFullscreen}>{fullscreen ? "退出全屏" : "全屏"}</MenuItem>
            <MenuItem role="menuitemcheckbox" aria-checked={pinned.topBar} onClick={() => togglePinned("topBar")}>
              <span className="viewChromeCheck">{pinned.topBar ? "✓" : ""}</span>
              <span>标题栏</span>
            </MenuItem>
            <MenuItem role="menuitemcheckbox" aria-checked={pinned.leftDock} onClick={() => togglePinned("leftDock")}>
              <span className="viewChromeCheck">{pinned.leftDock ? "✓" : ""}</span>
              <span>工具面板</span>
            </MenuItem>
            <MenuItem role="menuitemcheckbox" aria-checked={pinned.rightDock} onClick={() => togglePinned("rightDock")}>
              <span className="viewChromeCheck">{pinned.rightDock ? "✓" : ""}</span>
              <span>属性面板</span>
            </MenuItem>
            <MenuItem role="menuitemcheckbox" aria-checked={pinned.bottomBar} onClick={() => togglePinned("bottomBar")}>
              <span className="viewChromeCheck">{pinned.bottomBar ? "✓" : ""}</span>
              <span>状态栏</span>
            </MenuItem>
          </Menu>
          <Menu label="运行">
            <MenuItem disabled title="阶段 6 提供（恢复原版跨应用运行桥接）">
              运行场景
            </MenuItem>
          </Menu>
          <Menu label="设置">
            <MenuItem onClick={onOpenSettings}>编辑器设置…</MenuItem>
            <MenuItem title="清除本地保存的停靠栏钉住/收起偏好，恢复默认" onClick={() => dockChrome.clearCache()}>
              清除缓存…
            </MenuItem>
          </Menu>
          <Menu label="帮助">
            <MenuItem disabled title="阶段 9 提供">
              用户手册
            </MenuItem>
            <MenuItem disabled title="尚未提供">
              关于
            </MenuItem>
          </Menu>
        </nav>
        <div className="topBarCenter" id="topBarSceneTitle">
          {sceneTitle || "场景编辑器"}
        </div>
        <div className="topBarSpacer" />
        <div className="topBarTrailing">
          <div className="editModeToggle" role="group" aria-label="变换模式：移动 / 旋转 / 缩放">
            {["translate", "rotate", "scale"].map((m) => (
              <button
                key={m}
                type="button"
                className={`editModeSeg${gizmoMode === m ? " editModeSegActive" : ""}`}
                aria-pressed={gizmoMode === m}
                disabled={!selectedObject}
                title={selectedObject ? { translate: "移动", rotate: "旋转", scale: "缩放" }[m] : "请先选择对象"}
                onClick={() => onGizmoModeChange(m)}
              >
                {{ translate: "移动", rotate: "旋转", scale: "缩放" }[m]}
              </button>
            ))}
          </div>
          <button
            className="toolBtn secondary"
            type="button"
            disabled
            title="阶段 6 提供（恢复原版跨应用运行桥接）"
          >
            ▶ 运行
          </button>
          <button
            className="toolBtn secondary"
            type="button"
            onClick={() => {
              const url = window.prompt("场景 JSON 的 URL", sceneUrl);
              if (url) {
                onSceneUrlChange(url);
                onLoadUrl(url);
              }
            }}
          >
            打开
          </button>
          <button
            className="toolBtn secondary"
            type="button"
            disabled={!player.hasScene}
            onClick={() => void editor.runCommand("editor.view.fit")}
          >
            复位
          </button>
          <button className="toolBtn secondary" type="button" onClick={toggleFullscreen}>
            {fullscreen ? "退出全屏" : "全屏"}
          </button>
        </div>
      </header>
    </div>
  );
}
