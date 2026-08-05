/** Matches tools/scene-host/editor's .sidePanelPinBtn — the pushpin icon toggling pin/unpin for a dock. */
export function PinButton({ pinned, onToggle, title }) {
  return (
    <button
      type="button"
      className="sidePanelPinBtn"
      aria-pressed={pinned}
      title={title || (pinned ? "已钉住：鼠标移开仍显示" : "未钉住：鼠标移开会收起")}
      onClick={onToggle}
    >
      <svg className="sidePanelPinIcon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 1.6 9.4 5.5 13.3 6.4 9.4 7.3 8 11.2 6.6 7.3 2.7 6.4 6.6 5.5 8 1.6z"
        />
        <path fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" d="M8 10.2v4.2" />
      </svg>
    </button>
  );
}
