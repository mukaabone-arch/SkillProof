import type { Metadata } from 'next';
import { Suspense } from 'react';
import HelpTabs from '@/components/help/HelpTabs';
import { loadHelpGuide } from '@/lib/helpGuideSource';

export const metadata: Metadata = {
  title: 'Help · MyAmbii',
  description: 'How MyAmbii works for candidates and employers — verification, matching, assessments, and the hiring pipeline.',
};

/**
 * Server component on purpose (no 'use client' here) so `metadata` above
 * can be a plain export, and so the two guides' markdown can be read off
 * disk here (fs, Node-only) and passed down as props — HelpTabs itself is
 * the client component (tab state via useSearchParams), wrapped in
 * Suspense for the same reason EmployerShortlistPage wraps
 * EmployerShortlist: useSearchParams requires a Suspense boundary in the
 * app router.
 */
export default function HelpPage() {
  const candidate = loadHelpGuide('candidate-guide.md');
  const employer = loadHelpGuide('employer-guide.md');

  return (
    <Suspense fallback={<main className="lp-page lp-help-page" />}>
      <HelpTabs
        candidateMarkdown={candidate.markdown}
        candidateSections={candidate.sections}
        employerMarkdown={employer.markdown}
        employerSections={employer.sections}
      />
    </Suspense>
  );
}
