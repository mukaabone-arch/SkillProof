import Link from 'next/link';
import Logo from '../Logo';

/**
 * Coming-soon stub for a legal document that doesn't exist yet (Privacy
 * Policy, Terms of Service). Exists so the landing footer links resolve to a
 * real, honest "coming soon" page rather than a 404 — real legal copy is
 * still to be supplied. Self-contained and minimal; replaced wholesale once
 * the documents land.
 */
export default function LegalStub({ title }: { title: string }) {
  return (
    <main className="legal-stub">
      <Link href="/" className="legal-stub-brand" aria-label="SkillProof home">
        <Logo className="brand-logo-hero" />
        <span className="brand-product-name">SkillProof</span>
      </Link>
      <h1 className="legal-stub-title">{title}</h1>
      <p className="legal-stub-badge">Coming soon</p>
      <p className="legal-stub-body">
        This document is being finalised and will be published here. In the meantime, questions can go to{' '}
        <Link href="/contact">SkillProof</Link>.
      </p>
      <p className="legal-stub-company">Mukaab Technologies Private Limited</p>
    </main>
  );
}
