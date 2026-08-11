import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';

/**
 * FAQ — its own route (/faq), moved off the landing page so the marketing
 * scroll stays focused and a hesitant visitor can be linked straight here.
 * Same sub-page pattern as the contact form (app/contact/page.tsx): a centered
 * Nocturne column with the brand lockup linking home at the top. Unlike
 * contact, this is a plain server component — the accordion is native
 * <details>/<summary>, so it needs no client JS or state.
 *
 * Questions and answers are carried over verbatim from the old landing section.
 * The answers are deliberate placeholders — real copy (how assessments work,
 * pricing, review turnaround) will be supplied and must not be invented here.
 */
export const metadata: Metadata = {
  title: 'FAQ — SkillProof',
  description: 'Frequently asked questions about SkillProof — how verification works, and what it means for candidates and employers.',
};

const FAQS = [
  'How do the skill assessments work?',
  'Is SkillProof free for candidates?',
  'How long does verification take?',
  'How do employers use verified profiles?',
  'Which AI skills and levels can I get verified?',
];

export default function FaqPage() {
  return (
    <main className="lp-page lp-faq-page" id="top">
      <div className="lp-container lp-faq-wrap">
        <Link href="/" className="lp-brand lp-faq-brand" aria-label="SkillProof home">
          <Logo className="brand-logo-hero" />
          <span className="brand-product-name">SkillProof</span>
        </Link>

        <div className="lp-faq-panel">
          <p className="lp-section-eyebrow">FAQ</p>
          <h1 className="lp-section-title" style={{ marginBottom: 20 }}>
            Frequently asked questions
          </h1>
          <div className="lp-faq">
            {FAQS.map((q) => (
              <details className="lp-faq-item" key={q}>
                <summary className="lp-faq-q">{q}</summary>
                <p className="lp-faq-a">
                  <span className="lp-placeholder-tag">Placeholder</span> Answer to be supplied — not drafted here to
                  avoid inventing specifics about assessments, pricing, or review turnaround.
                </p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
