/** Status bar, ported from tools/scene-host/editor's <footer class="bottomBar">. */
export function BottomBar({ gizmoVisible, onToggleGizmo, axesVisible, onToggleAxes, gridVisible, onToggleGrid }) {
  return (
    <div className="bottomChromeWrap" id="bottomChromeWrap">
      <footer className="bottomBar">
        <span id="eventNotice">操作指南：左键旋转，右键拖动，滚轮缩放；场景树单击高亮，双击高亮+描边+编辑。</span>
        <div className="bottomBarSpacer" />
        <div className="bottomBarToggles">
          <button
            type="button"
            className="bottomBarToggleBtn"
            aria-pressed={axesVisible}
            title="显示/隐藏坐标轴辅助线（仅当前场景）"
            onClick={onToggleAxes}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                d="M8 14V2M8 2 5.5 4.5M8 2l2.5 2.5M2 12h9M11 12l-2-1.6M11 12l-2 1.6"
              />
              <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            type="button"
            className="bottomBarToggleBtn"
            aria-pressed={gridVisible}
            title="显示/隐藏地面网格辅助线（仅当前场景）"
            onClick={onToggleGrid}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
                d="M1.5 1.5h13v13h-13z M1.5 5.83h13 M1.5 10.17h13 M5.83 1.5v13 M10.17 1.5v13"
              />
            </svg>
          </button>
          <button
            type="button"
            className="bottomBarToggleBtn"
            aria-pressed={gizmoVisible}
            title="显示/隐藏视角指示器（仅本次运行）"
            onClick={onToggleGizmo}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
                d="m8 1.5 5.5 3.1v6.8L8 14.5l-5.5-3.1V4.6L8 1.5Zm0 0v6.7m5.5-3.6L8 8.2 2.5 4.6M8 8.2v6.3"
              />
            </svg>
          </button>
        </div>
      </footer>
      <div className="chromePeekStrip chromePeekStripBottom" aria-hidden="true" />
    </div>
  );
}
