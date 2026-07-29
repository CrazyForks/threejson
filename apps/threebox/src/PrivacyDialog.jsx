/**
 * Consent gate for ThreeBox's built-in trial provider.
 *
 * This must be explicit and cannot be skipped: prompts sent through the built-in backend are
 * content-moderated server-side and tied to an anonymous per-device identifier for quota and abuse
 * enforcement. The decision itself is persisted by host-kit's builtinProviderPrivacy; this component
 * only presents it.
 *
 * Declining is a supported path — the user can still use ThreeBox with their own provider, whose
 * traffic never touches ThreeBox's moderation pipeline or device identifier.
 */
export function PrivacyDialog({ deviceId, onAccept, onDecline }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="privacyTitle">
      <div className="dialog">
        <h2 id="privacyTitle">Built-in provider — privacy notice</h2>
        <div className="dialogBody">
          <p>
            ThreeBox offers a free, quota-limited built-in AI provider so you can start without any
            configuration. To use it you must read and accept the following.
          </p>

          <section>
            <strong>Server-side content review</strong>
            <p className="muted">
              Every prompt you send through the built-in provider is reviewed by the ThreeBox server
              before processing — screening for terrorism, violence or threats, and (in mainland
              China) sexual and politically sensitive content. Your full chat history is not stored;
              prompts that pass review are not persisted as chat content. When something is flagged,
              the server may record the review result and a short excerpt, and may flag-and-allow,
              temporarily mute, or permanently ban the anonymous identity depending on severity.
            </p>
          </section>

          <section>
            <strong>Anonymous device identity</strong>
            <p className="muted">
              An anonymous identifier is derived from browser and device characteristics for quota,
              abuse prevention, and enforcement. It does not require your name or an account.
              {deviceId ? (
                <>
                  {" "}
                  Yours is <code>{deviceId}</code> — include it if you report a problem.
                </>
              ) : null}
            </p>
          </section>

          <section>
            <strong>Using your own provider instead</strong>
            <p className="muted">
              A provider you configure yourself does not go through the ThreeBox review pipeline and
              is not associated with the anonymous identifier. That provider may still apply its own
              content policies, logging, and account rules — those are its responsibility, not
              ThreeBox's.
            </p>
          </section>

          <section>
            <strong>Local data</strong>
            <p className="muted">
              Settings stay in this browser's local storage. Export anything you want to keep;
              clearing browser data removes it.
            </p>
          </section>

          <p className="muted">
            If you decline, the built-in provider stays disabled and you can configure your own
            provider in Settings.
          </p>
        </div>
        <div className="dialogFooter">
          <button onClick={onDecline}>Decline</button>
          <button className="primary" onClick={onAccept}>
            I agree
          </button>
        </div>
      </div>
    </div>
  );
}
