'use client';

/**
 * Employer portal entry: OTP login/registration for anonymous visitors,
 * org home once authenticated. Kept fully separate from the candidate app —
 * an employer never lands on the candidate dashboard, and vice versa
 * (enforced server-side by the role checks in /auth/employer/register).
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';
import EmployerOtpLogin from '@/components/EmployerOtpLogin';
import EmployerHome from '@/components/EmployerHome';

const { getToken } = employerApi;

export default function EmployerPage() {
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed'>('loading');

  useEffect(() => {
    setStatus(getToken() ? 'authed' : 'anon');
  }, []);

  if (status === 'loading') return <main><p>Loading…</p></main>;
  if (status === 'anon') return <EmployerOtpLogin onLoggedIn={() => setStatus('authed')} />;
  return <EmployerHome onLoggedOut={() => setStatus('anon')} />;
}
