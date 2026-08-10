'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';

/**
 * Client-side entry guard for candidate-only pages. Tokens live in
 * localStorage, so this can't be Next middleware — the check runs in an
 * effect on mount, and redirects to the candidate sign-in ('/candidate')
 * when there's no token — never to the marketing landing at '/'. Callers
 * must not render authenticated content until this returns
 * true (e.g. `if (!useRequireAuth()) return null;` before any real markup),
 * so a logged-out visitor never sees a flash of real data.
 */
export function useRequireAuth(): boolean {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/candidate');
      return;
    }
    setReady(true);
  }, [router]);

  return ready;
}
