/**
 * Left dock: 组件 / 资源 / AI生成 / AI调整 tabs, ported from tools/scene-host/editor's
 * #leftPanel.sidePanel.leftDockPanel. Only 组件 has real (if minimal) content this phase; the other
 * three are placeholder stubs naming the phase that fills them in — the tab chrome itself (bar, pin,
 * peek) is the faithful part of this phase, not the panel contents.
 */
import { useState } from "react";
import { PinButton } from "./PinButton.jsx";

const TABS = [
  { id: "builtin", label: "组件" },
  { id: "assetLibrary", label: "资源" },
  { id: "aiGenerate", label: "AI 生成" },
  { id: "aiAdjust", label: "AI 调整" }
];

function Stub({ text }) {
  return <p className="sceneManageHint">{text}</p>;
}

export function LeftDock({ pinned, onTogglePin, onMouseEnter, onMouseLeave }) {
  const [active, setActive] = useState("builtin");
  return (
    <div id="leftFlyoutHost" className="flyoutHost flyoutHostLeft" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div id="leftDock" className="leftDock">
        <aside id="leftPanel" className="sidePanel leftDockPanel">
          <div className="sidePanelPinRow sidePanelPinRowLeft">
            <PinButton pinned={pinned} onToggle={onTogglePin} />
            <span className="sidePanelChromeTitle">工具面板</span>
          </div>
          <div className="sidePanelStack">
            <div className="leftSubTabBar" role="tablist" aria-label="左侧功能" aria-orientation="horizontal">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`leftSubTab${active === tab.id ? " leftSubTabSelected" : ""}`}
                  role="tab"
                  aria-selected={active === tab.id}
                  onClick={() => setActive(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="leftDockTabPanels">
              <div className="leftSubPanel" role="tabpanel" hidden={active !== "builtin"}>
                <div className="panelCard">
                  <div className="panelTitle">组件</div>
                  <Stub text="组件库面板将在阶段 9 提供。" />
                </div>
                <div className="panelCard">
                  <div className="panelTitle">说明</div>
                  <div className="propLine">画布双击物体：描边（包围盒）+ 进入编辑，不高亮</div>
                  <div className="propLine">
                    场景树单击：后处理高亮；场景树双击：高亮 + 描边 + 编辑；点击物体或 gizmo 取消高亮；右键清除高亮/描边并退出编辑
                  </div>
                  <div className="propLine">Esc：退出浏览器全屏</div>
                </div>
              </div>
              <div className="leftSubPanel" role="tabpanel" hidden={active !== "assetLibrary"}>
                <div className="panelCard">
                  <div className="panelTitle">资源库</div>
                  <Stub text="资源库面板将在阶段 5 提供。" />
                </div>
              </div>
              <div className="leftSubPanel" role="tabpanel" hidden={active !== "aiGenerate"}>
                <div className="panelCard aiEditPanelCard">
                  <div className="panelTitle">AI 生成</div>
                  <Stub text="AI 生成面板将在阶段 7 提供。" />
                </div>
              </div>
              <div className="leftSubPanel" role="tabpanel" hidden={active !== "aiAdjust"}>
                <div className="panelCard aiEditPanelCard">
                  <div className="panelTitle">AI 调整</div>
                  <Stub text="AI 调整面板将在阶段 7 提供。" />
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div className="edgeHoverZone edgeHoverZoneLeft" aria-hidden="true" />
    </div>
  );
}
