'use client';

/**
 * The "You've signed out" note on the landing page after a deliberate
 * log-out (lib/signedOut.ts). Reads the flag from the URL once, then removes
 * it, so a refresh or a shared link doesn't show the note again. Hides
 * itself after a few seconds; reduced-motion users get no slide.
 */
import { useEffect, useState } from 'react';
import { SIGNED_OUT_PARAM } from '@/lib/signedOut';

const VISIBLE_MS = 5000;

export default function SignedOutNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SIGNED_OUT_PARAM)) return;
    url.searchParams.delete(SIGNED_OUT_PARAM);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    setShow(true);
    const timer = window.setTimeout(() => setShow(false), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="signed-out-notice" role="status">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>You&rsquo;ve signed out.</span>
      <button type="button" className="signed-out-notice-close" onClick={() => setShow(false)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
