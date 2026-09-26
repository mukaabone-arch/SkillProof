'use client';

import { useEffect, useState } from 'react';
import { ANALYTICS_CONSENT_CHANGED_EVENT, readAnalyticsConsent, withdrawAnalyticsConsent } from '@/lib/analyticsConsent';

/**
 * Footer entry point for changing an analytics consent decision.
 *
 * DPDP expects withdrawal to be as easy as giving consent. Without this the
 * banner is a one-way door: once a visitor accepts or declines it never
 * reappears and the decision can't be revisited.
 *
 * Shown only once a decision exists — while the banner is still up it's
 * already asking, so a second control would be noise. Rendered as nothing
 * during SSR and the first client render, because localStorage isn't
 * readable on the server and reading it during render would hydrate
 * mismatched markup.
 */
export default function ConsentSettingsLink() {
  const [decision, setDecision] = useState<'granted' | 'denied' | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDecision(readAnalyticsConsent());
    setReady(true);

    // AnalyticsGate's own Accept/Decline live in a different component tree
    // with no shared state — this is what picks up a decision made on THIS
    // same page load, not just on a later navigation (see
    // ANALYTICS_CONSENT_CHANGED_EVENT's own doc comment).
    const onChange = () => setDecision(readAnalyticsConsent());
    window.addEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ANALYTICS_CONSENT_CHANGED_EVENT, onChange);
  }, []);

  if (!ready || decision === null) return null;

  return (
    <button
      type="button"
      style={{ alignSelf: 'flex-start' }}
      className="lp-footer-consent-link"
      onClick={() => {
        withdrawAnalyticsConsent();
        // Full reload rather than a router navigation: an already-loaded
        // gtag.js can't be unloaded, so the only way to stop it running in
        // this page's lifetime is to tear the page down. On the way back up
        // there's no stored decision, so AnalyticsGate shows the banner
        // again and loads nothing.
        window.location.reload();
      }}
    >
      {decision === 'granted' ? 'Analytics: on — change' : 'Analytics: off — change'}
    </button>
  );
}
