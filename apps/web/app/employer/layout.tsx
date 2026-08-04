'use client';

/**
 * Shared shell for every employer route. Auth-gating is centralized here
 * instead of duplicated per-page (the old pattern — see git history on
 * /employer/shortlist and /employer/dashboard, which each ran their own
 * getToken() check-and-redirect before this layout existed). The root
 * /employer route is the one exception: it renders the OTP login itself
 * for anonymous visitors, so it manages its own status and is rendered
 * bare here, with no sidebar.
 */
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import EmployerSidebarShell from '@/components/EmployerSidebarShell';

const { getToken } = employerApi;

export default function EmployerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (pathname === '/employer') {
      setReady(true);
      return;
    }
    if (!getToken()) {
      router.replace('/employer');
      return;
    }
    setReady(true);
  }, [pathname, router]);

  if (pathname === '/employer') return <>{children}</>;
  if (!ready) return null;

  return (
    <EmployerSidebarShell onLoggedOut={() => router.replace('/employer')}>
      {children}
    </EmployerSidebarShell>
  );
}
