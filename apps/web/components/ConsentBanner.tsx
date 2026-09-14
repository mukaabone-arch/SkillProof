'use client';

/** Pure presentation — AnalyticsGate owns the actual consent decision/storage. */
export default function ConsentBanner({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="consent-banner" role="dialog" aria-label="Cookie consent">
      <p className="consent-banner-text">
        We&apos;d like to use Google Analytics to understand how MyAmbii is used. Nothing is tracked unless you
        accept, and you can change your mind at any time.{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="consent-banner-link">
          Privacy Policy
        </a>
      </p>
      <div className="consent-banner-actions">
        <button type="button" onClick={onAccept}>Accept</button>
        <button type="button" className="btn-secondary" onClick={onDecline}>Decline</button>
      </div>
    </div>
  );
}
