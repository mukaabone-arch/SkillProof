'use client';

/**
 * One-time notice + agreement that a session's answers are processed by our
 * AI provider (App Store guideline 5.1.2(i); recorded server-side as
 * User.aiConsentAt, enforced by the API's AiConsentGuard). Shown on a start
 * page while the candidate hasn't agreed; also the fallback when a start call
 * comes back 403 { code: 'AI_CONSENT_REQUIRED' }.
 */
import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

export const AI_CONSENT_REQUIRED = 'AI_CONSENT_REQUIRED';

export function isAiConsentRequired(e: unknown): boolean {
  const err = e as ApiError | undefined;
  return err?.status === 403 && (err.body as { code?: string } | undefined)?.code === AI_CONSENT_REQUIRED;
}

export default function AiConsentNotice({ onAgreed }: { onAgreed: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function agree() {
    setSaving(true);
    setError('');
    try {
      await api('/profiles/me/ai-consent', { method: 'POST' });
      onAgreed();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <section
      className="card"
      aria-labelledby="ai-consent-title"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}
    >
      <h2 id="ai-consent-title" style={{ margin: 0, fontSize: '1.1rem' }}>
        Your answers are evaluated by AI
      </h2>
      <p style={{ margin: 0 }}>
        To run and score this session, your responses are sent to our AI provider, Anthropic. You only need to
        agree once. <Link href="/privacy">Privacy policy</Link>
      </p>
      {error && <p className="error">{error}</p>}
      <div>
        <button onClick={agree} disabled={saving}>
          {saving ? 'Saving…' : 'I agree'}
        </button>
      </div>
    </section>
  );
}
