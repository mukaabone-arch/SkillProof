import type { Metadata } from 'next';
import HelpGuidePage from '@/components/help/HelpGuidePage';
import { loadHelpGuide } from '@/lib/helpGuideSource';

export const metadata: Metadata = {
  title: 'Candidate help · MyAmbii',
  description:
    'How MyAmbii works for candidates — assessments, verification, badges, retakes, and applying to roles.',
};

/**
 * Server component (no 'use client') so `metadata` above can be a plain
 * export and the markdown can be read off disk here via fs.
 *
 * Reachable without an account on purpose. Candidates arrive because an
 * employer sent them an assessment request, not by choice — "what is this,
 * how long does it take, what happens to my result" are all questions that
 * land before signup.
 *
 * Also exempt in lib/candidateVerification.tsx's GATE_EXEMPT_PATH_PREFIXES
 * — that provider redirects an incomplete-verification candidate to
 * /verify on any non-exempt route, which would otherwise hijack this tab
 * the moment it opened for exactly the candidates most likely to need it
 * (OAuth signups missing a phone number). Confirm the prefix list covers
 * /help/candidate, not just /help.
 */
export default function CandidateHelpPage() {
  const { markdown, sections } = loadHelpGuide('candidate-guide.md');
  return <HelpGuidePage title="Candidate help" markdown={markdown} sections={sections} />;
}
