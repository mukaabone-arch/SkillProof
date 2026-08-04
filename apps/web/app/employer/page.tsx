'use client';

/**
 * Employer portal entry: OTP login/registration for anonymous visitors,
 * org home once authenticated. Kept fully separate from the candidate app —
 * an employer never lands on the candidate dashboard, and vice versa
 * (enforced server-side by the role checks in /auth/employer/register).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import EmployerOtpLogin from '@/components/EmployerOtpLogin';

const { getToken } = employerApi;

export default function EmployerPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed'>('loading');

  useEffect(() => {
    if (getToken()) {
      router.replace('/employer/dashboard');
      setStatus('authed');
    } else {
      setStatus('anon');
    }
  }, [router]);

  if (status === 'loading' || status === 'authed') return <main className="app-loading"><p>Loading…</p></main>;
  return <EmployerOtpLogin onLoggedIn={() => router.replace('/employer/dashboard')} />;
}
