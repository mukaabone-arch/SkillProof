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
import ReactivatePrompt from '@/components/ReactivatePrompt';

interface Me {
  role: string;
}
interface AccountStatus {
  deactivated: boolean;
}

export default function Home() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'anon' | 'authed' | 'deactivated'>('loading');

  const resolveRole = useCallback(async () => {
    setStatus('loading');
    try {
      const me = await api<Me>('/users/me');
      if (me.role === 'PLATFORM_ADMIN') {
        router.replace('/admin/assessments');
        return;
      }
      // Best-effort — a failure here (network hiccup, a non-candidate role
      // this endpoint 404s for) should never block an otherwise-working
      // sign-in; it just means a deactivated candidate falls through to the
      // normal dashboard instead of the reactivation prompt this once,
      // which is a worse UX, not a broken one.
      const account = await api<AccountStatus>('/account/status').catch(() => null);
      if (account?.deactivated) {
        setStatus('deactivated');
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

  if (status === 'loading') return <main className="app-loading"><p>Loading…</p></main>;
  if (status === 'anon') return <OtpLogin onLoggedIn={resolveRole} />;
  if (status === 'deactivated') {
    return <ReactivatePrompt onReactivated={resolveRole} onDeclined={() => setStatus('anon')} />;
  }
  return <Dashboard onLoggedOut={() => setStatus('anon')} />;
}
