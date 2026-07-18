'use client';

/** Same client-side entry guard as /employer/shortlist (EmployerShortlistPage) — see that file's comment. */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import EmployerNav from '@/components/EmployerNav';
import EmployerDashboard from '@/components/EmployerDashboard';

const { getToken } = employerApi;

export default function EmployerDashboardPage() {
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
      <EmployerDashboard />
    </>
  );
}
