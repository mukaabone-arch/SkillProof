'use client';

/**
 * Shared shell for every /admin/* route. Unlike app/employer/layout.tsx,
 * there's no anonymous-accessible page under this tree to special-case —
 * admins sign in through the same candidate OTP flow at '/' (see
 * AdminNav's own note on this), so any request here with no token at all
 * just bounces to '/'. Wrong-role-but-logged-in (a candidate token, say)
 * is NOT checked here — each page already probes its own endpoint and
 * shows its own "admins only" message on a 403, exactly as before this
 * shell existed; centralizing that here would mean re-deriving per-page
 * what "the right endpoint" even is.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';
import AdminSidebarShell from '@/components/AdminSidebarShell';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <AdminSidebarShell onLoggedOut={() => router.replace('/')}>
      {children}
    </AdminSidebarShell>
  );
}
