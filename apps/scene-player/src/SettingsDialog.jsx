/**
 * Player settings, driven by @threejson/react's usePlayerSettings (which wraps host-kit's async
 * settings store: shipped setting.json defaults merged with the localStorage cache).
 *
 * `setByPath` writes a single dotted path and persists immediately, so each control here is a
 * one-liner rather than a form-state reducer.
 */
import { useHostI18n } from "@threejson/react/i18n";

export function SettingsDialog({ api, onClose }) {
  const { t } = useHostI18n();
  const { settings, loading, setByPath, resetToFileDefaults } = api;

  if (loading || !settings) {
    return (
      <div className="overlay" role="dialog" aria-modal="true">
        <div className="dialog">
          <h2>{t("player.shell.settings", "Settings")}</h2>
          <div className="dialogBody">{t("player.message.loading", "Loading…")}</div>
        </div>
      </div>
    );
  }

  const render = settings.render || {};
  const playback = settings.playback || {};
  const audio = settings.audio || {};

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog">
        <h2>{t("player.shell.settings", "Settings")}</h2>
        <div className="dialogBody">
          <div className="field">
            <label htmlFor="fps">{t("player.settings.fields.render.targetFps", "Target FPS")}</label>
            <select
              id="fps"
              value={render.targetFps ?? 60}
              onChange={(e) => setByPath("render.targetFps", Number(e.target.value))}
            >
              <option value={30}>30</option>
              <option value={60}>60</option>
              <option value={120}>120</option>
            </select>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={render.antialias !== false}
              onChange={(e) => setByPath("render.antialias", e.target.checked)}
            />
            {t("player.settings.fields.render.antialias", "Antialiasing")}
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={render.lowFpsMode === true}
              onChange={(e) => setByPath("render.lowFpsMode", e.target.checked)}
            />
            {t("player.settings.fields.render.lowFpsMode", "Low-FPS mode")}
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={playback.sceneAutoRotate === true}
              onChange={(e) => setByPath("playback.sceneAutoRotate", e.target.checked)}
            />
            {t("player.settings.fields.playback.sceneAutoRotate", "Auto-rotate scene")}
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={playback.restorePlaylistOnStartup !== false}
              onChange={(e) => setByPath("playback.restorePlaylistOnStartup", e.target.checked)}
            />
            {t("player.settings.fields.playback.restorePlaylistOnStartup", "Restore playlist on startup")}
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={audio.rememberVolume !== false}
              onChange={(e) => setByPath("audio.rememberVolume", e.target.checked)}
            />
            {t("player.settings.fields.audio.rememberVolume", "Remember volume")}
          </label>

          <div className="field">
            <label htmlFor="gateway">
              {t("player.settings.fields.general.assetGatewayUrl", "Asset gateway URL")}
            </label>
            <input
              id="gateway"
              type="text"
              value={settings.general?.assetGatewayUrl || ""}
              placeholder="https://api.threebox.org"
              onChange={(e) => setByPath("general.assetGatewayUrl", e.target.value)}
            />
          </div>

          <p className="muted">
            {t(
              "player.settings.note.appliesNextLoad",
              "Render and asset settings apply to the next scene load."
            )}
          </p>
        </div>
        <div className="dialogFooter">
          <button onClick={() => void resetToFileDefaults()}>
            {t("player.shell.resetDefaults", "Restore defaults")}
          </button>
          <button className="primary" onClick={onClose}>
            {t("player.shell.close", "Done")}
          </button>
        </div>
      </div>
    </div>
  );
}
