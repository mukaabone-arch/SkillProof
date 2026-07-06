'use client';

/** Candidate home: OTP login for anonymous visitors, dashboard once authenticated. */
import { useEffect, useState } from 'react';
import { getToken } from '@/lib/api';
import OtpLogin from '@/components/OtpLogin';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed'>('loading');

  useEffect(() => {
    setStatus(getToken() ? 'authed' : 'anon');
  }, []);

  if (status === 'loading') return <main><p>Loading…</p></main>;
  if (status === 'anon') return <OtpLogin onLoggedIn={() => setStatus('authed')} />;
  return <Dashboard onLoggedOut={() => setStatus('anon')} />;
}
