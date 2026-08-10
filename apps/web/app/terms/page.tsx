import Link from 'next/link';
import LegalPlaceholder from '@/components/LegalPlaceholder';

/**
 * Placeholder Terms of Service route. It exists so the acceptance line's
 * links (see LegalAcceptanceNote) resolve rather than 404 — the actual legal
 * copy has not been drafted yet. Keep the version shown here in step with
 * TERMS_VERSION in the API's legal-terms.ts once real text lands.
 */
export const metadata = { title: 'Terms of Service · SkillProof' };

export default function TermsPage() {
  return (
    <LegalPlaceholder title="Terms of Service" version="2026-08-10">
      The full Terms of Service are being finalised. In the meantime, questions can go to{' '}
      <Link href="/">the SkillProof team</Link>.
    </LegalPlaceholder>
  );
}
