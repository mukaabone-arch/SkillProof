'use client';

/**
 * The "Stop recruiter messages" link in outreach emails. Works signed out:
 * the link carries an HMAC token for this one user (see the API's
 * outreach.util.ts). Turns recruiter contact off; the candidate can turn it
 * back on from Opportunities.
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import PublicNav from '@/components/PublicNav';
import { api } from '@/lib/api';

function Unsubscribe() {
  const params = useSearchParams();
  const u = params.get('u') ?? '';
  const t = params.get('t') ?? '';
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');

  useEffect(() => {
    if (!u || !t) {
      setState('failed');
      return;
    }
    api('/outreach/unsubscribe', { method: 'POST', body: JSON.stringify({ u, t }) })
      .then(() => setState('done'))
      .catch(() => setState('failed'));
  }, [u, t]);

  if (state === 'working') return <p>Updating your settings…</p>;
  if (state === 'failed') {
    return (
      <>
        <h1>That link didn’t work</h1>
        <p>
          Sign in and open <Link href="/opportunities#contact-settings">Opportunities</Link> to choose who can contact you.
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Recruiter messages are off</h1>
      <p>Employers and recruiters won’t message you about roles any more, and reminders already scheduled are cancelled.</p>
      <p>
        Changed your mind? Turn it back on any time from <Link href="/opportunities#contact-settings">Opportunities</Link>.
      </p>
    </>
  );
}

export default function OutreachUnsubscribePage() {
  return (
    <>
      <PublicNav />
      <main className="container-standard" style={{ maxWidth: 640 }}>
        <Suspense fallback={null}>
          <Unsubscribe />
        </Suspense>
      </main>
    </>
  );
}
