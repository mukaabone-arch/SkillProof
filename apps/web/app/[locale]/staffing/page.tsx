'use client';

/**
 * Staffing-company entry: the same work-email OTP sign-in/sign-up as
 * /employer (EmployerOtpLogin), worded for staffing and recruitment
 * companies. A brand-new organisation created here is set to STAFFING
 * straight away (see EmployerOtpLogin's variant), so setup never asks which
 * kind it is. Signed-in visitors go to Find talent — app/employer/layout.tsx
 * sends an employer org to its own dashboard instead.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import EmployerOtpLogin from '@/components/EmployerOtpLogin';

const { getToken } = employerApi;

export default function StaffingEntryPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed'>('loading');

  useEffect(() => {
    if (getToken()) {
      router.replace('/employer/talent');
      setStatus('authed');
    } else {
      setStatus('anon');
    }
  }, [router]);

  if (status === 'loading' || status === 'authed') return <main className="app-loading"><p>Loading…</p></main>;
  return <EmployerOtpLogin variant="staffing" onLoggedIn={() => router.replace('/employer/talent')} />;
}
