import type { Metadata } from 'next';
import HelpGuidePage from '@/components/help/HelpGuidePage';
import { loadHelpGuide } from '@/lib/helpGuideSource';

export const metadata: Metadata = {
  title: 'Employer help · MyAmbii',
  description:
    'How MyAmbii works for employers — assessment requests, shortlisting, seats and invites, and the hiring pipeline.',
};

/**
 * Server component (no 'use client') so `metadata` above can be a plain
 * export and the markdown can be read off disk here via fs.
 *
 * Public, not gated. Employers evaluate documentation before they sign up,
 * and gating it would cost SEO and the ability to link it from a sales
 * conversation while protecting nothing — this guide carries no pricing
 * (deliberately removed 2026-09; the charge is disclosed and agreed at the
 * confirm step in AssessCandidateAction, which is the authenticated
 * surface). Making this route authenticated would remove the reason that
 * content was stripped, so if it is ever gated, revisit that decision
 * explicitly rather than assuming it still holds.
 */
export default function EmployerHelpPage() {
  const { markdown, sections } = loadHelpGuide('employer-guide.md');
  return <HelpGuidePage title="Employer help" markdown={markdown} sections={sections} />;
}
