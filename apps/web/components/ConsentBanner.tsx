'use client';

import { useTranslations } from 'next-intl';

/** Pure presentation — AnalyticsGate owns the actual consent decision/storage. */
export default function ConsentBanner({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const t = useTranslations('consent.banner');
  return (
    <div className="consent-banner" role="dialog" aria-label={t('label')}>
      <p className="consent-banner-text">
        {t('body')}{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="consent-banner-link">
          {t('privacy')}
        </a>
      </p>
      <div className="consent-banner-actions">
        <button type="button" onClick={onAccept}>{t('accept')}</button>
        <button type="button" className="btn-secondary" onClick={onDecline}>{t('decline')}</button>
      </div>
    </div>
  );
}
