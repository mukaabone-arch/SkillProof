import type { Metadata } from 'next';
import { Suspense } from 'react';
import HelpTabs from '@/components/help/HelpTabs';

export const metadata: Metadata = {
  title: 'Help · MyAmbii',
  description: 'How MyAmbii works for candidates and employers — verification, matching, assessments, and the hiring pipeline.',
};

/**
 * Server component on purpose (no 'use client' here) so `metadata` above
 * can be a plain export — HelpTabs itself is the client component (tab
 * state via useSearchParams), wrapped in Suspense for the same reason
 * EmployerShortlistPage wraps EmployerShortlist: useSearchParams requires
 * a Suspense boundary in the app router.
 */
export default function HelpPage() {
  return (
    <Suspense fallback={<main className="lp-page lp-help-page" />}>
      <HelpTabs />
    </Suspense>
  );
}
