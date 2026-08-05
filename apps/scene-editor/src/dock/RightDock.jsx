/**
 * Right dock: 对象 / 场景 / 事件 tabs, ported from tools/scene-host/editor's
 * #rightPanel.sidePanel.rightDockPanel. 对象 hosts the real scene tree + property inspector; 场景
 * and 事件 are placeholder stubs (场景 management lands in phase 5; 事件 in phase 9 — and even then,
 * the original itself leaves domain-object event editing as a "Phase 3" blank state, which the port
 * must preserve rather than build out).
 */
import { useState } from "react";
import { PinButton } from "./PinButton.jsx";

const TABS = [
  { id: "sceneTree", label: "对象" },
  { id: "sceneJson", label: "场景" },
  { id: "events", label: "事件" }
];

export function RightDock({ pinned, onTogglePin, onMouseEnter, onMouseLeave, children }) {
  const [active, setActive] = useState("sceneTree");
  return (
    <div id="rightFlyoutHost" className="flyoutHost flyoutHostRight" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div id="rightDock" className="rightDock">
        <aside id="rightPanel" className="sidePanel rightDockPanel">
          <div className="sidePanelPinRow sidePanelPinRowRight">
            <span className="sidePanelChromeTitle">属性面板</span>
            <PinButton pinned={pinned} onToggle={onTogglePin} />
          </div>
          <div className="sidePanelStack">
            <div className="rightSubTabBar" role="tablist" aria-label="右侧功能" aria-orientation="horizontal">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`rightSubTab${active === tab.id ? " rightSubTabSelected" : ""}`}
                  role="tab"
                  aria-selected={active === tab.id}
                  onClick={() => setActive(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="rightDockTabPanels">
              <div className="rightSubPanel" role="tabpanel" hidden={active !== "sceneTree"}>
                {children}
              </div>
              <div className="rightSubPanel" role="tabpanel" hidden={active !== "sceneJson"}>
                <div className="panelCard rightSceneJsonPanelCard">
                  <div className="panelTitle">场景管理</div>
                  <p className="sceneManageHint">场景管理面板（相机/渲染器/控制器等 sceneConfig 编辑）将在阶段 5 提供。</p>
                </div>
              </div>
              <div className="rightSubPanel" role="tabpanel" hidden={active !== "events"}>
                <div className="panelCard eventEditorPanelCard">
                  <div className="panelTitle">事件</div>
                  <p className="sceneManageHint">事件绑定编辑面板将在阶段 9 提供。</p>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div className="edgeHoverZone edgeHoverZoneRight" aria-hidden="true" />
    </div>
  );
}
