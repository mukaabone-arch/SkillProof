import type { Metadata } from 'next';
import HelpGuidePage from '@/components/help/HelpGuidePage';
import { loadHelpGuide } from '@/lib/helpGuideSource';

export const metadata: Metadata = {
  title: 'Recruiter help · MyAmbii',
  description:
    'How MyAmbii works for recruiters and staffing companies — finding available, verified talent, availability checks, clients and submissions.',
};

/**
 * Server component, public — same reasoning as app/help/employer/page.tsx:
 * recruiters evaluate how it works (consent, representation, no double
 * submission) before they sign up. Linked from the recruiter portal's sidebar
 * Help (EmployerSidebarShell, orgType STAFFING).
 */
export default function RecruiterHelpPage() {
  const { markdown, sections } = loadHelpGuide('recruiter-guide.md');
  return <HelpGuidePage title="Recruiter help" markdown={markdown} sections={sections} />;
}
