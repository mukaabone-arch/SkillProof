'use client';

/**
 * Candidate home: OTP login for anonymous visitors, dashboard once
 * authenticated. PLATFORM_ADMIN accounts share this same OTP login (see
 * prisma/make-admin.ts — admin is just a role flip on an ordinary user), so
 * once logged in we check the role and bounce admins straight to the admin
 * console rather than rendering the candidate dashboard for them.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import OtpLogin from '@/components/OtpLogin';
import Dashboard from '@/components/Dashboard';

interface Me {
  role: string;
}

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed'>('loading');

  const resolveRole = useCallback(async () => {
    setStatus('loading');
    try {
      const me = await api<Me>('/users/me');
      if (me.role === 'PLATFORM_ADMIN') {
        router.replace('/admin/assessments');
        return;
      }
    } catch {
      // Fall through to the candidate dashboard — it has its own error state.
    }
    setStatus('authed');
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      setStatus('anon');
      return;
    }
    resolveRole();
  }, [resolveRole]);

  if (status === 'loading') return <main><p>Loading…</p></main>;
  if (status === 'anon') return <OtpLogin onLoggedIn={resolveRole} />;
  return <Dashboard onLoggedOut={() => setStatus('anon')} />;
}
