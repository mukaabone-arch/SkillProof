'use client';

/**
 * Same client-side entry guard as /employer itself (EmployerPage) — tokens
 * live in localStorage under the employer scope, so this can't be Next
 * middleware. An anonymous visitor is sent back to /employer to log in
 * rather than duplicating EmployerOtpLogin here.
 */
import { Suspense, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import EmployerNav from '@/components/EmployerNav';
import EmployerShortlist from '@/components/EmployerShortlist';

const { getToken } = employerApi;

export default function EmployerShortlistPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/employer');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <>
      <EmployerNav onLoggedOut={() => router.replace('/employer')} />
      <Suspense fallback={<main><p className="meta">Loading…</p></main>}>
        <EmployerShortlist />
      </Suspense>
    </>
  );
}
