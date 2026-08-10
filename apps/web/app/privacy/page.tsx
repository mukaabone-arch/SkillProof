import Link from 'next/link';
import LegalPlaceholder from '@/components/LegalPlaceholder';

/**
 * Placeholder Privacy Policy route — companion to /terms. Exists so the
 * acceptance line's links resolve rather than 404; real copy is still to be
 * drafted. Keep the version in step with PRIVACY_VERSION in the API's
 * legal-terms.ts once the actual policy lands.
 */
export const metadata = { title: 'Privacy Policy · SkillProof' };

export default function PrivacyPage() {
  return (
    <LegalPlaceholder title="Privacy Policy" version="2026-08-10">
      The full Privacy Policy is being finalised. It will cover what assessment data we collect
      (including integrity telemetry) and how it is used. Questions can go to{' '}
      <Link href="/">the SkillProof team</Link>.
    </LegalPlaceholder>
  );
}
