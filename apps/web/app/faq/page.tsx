import type { Metadata } from 'next';
import BrandLockup from '@/components/BrandLockup';

/**
 * FAQ — its own route (/faq), moved off the landing page so the marketing
 * scroll stays focused and a hesitant visitor can be linked straight here.
 * Same sub-page pattern as the contact form (app/contact/page.tsx): a centered
 * Nocturne column with the brand lockup linking home at the top. Unlike
 * contact, this is a plain server component — the accordion is native
 * <details>/<summary>, so it needs no client JS or state.
 *
 * Answers are grounded in what the product actually does (assessor.service.ts,
 * assessments.service.ts, plans.config.ts, ReviewService, CandidatesService,
 * seed-mcq-import.ts) rather than marketing claims — see the audit that
 * produced this copy for the source of each fact. Two things worth knowing
 * before editing further: (1) MCQ assessments issue their badge
 * automatically the moment grading passes (AssessmentsService.gradeAttempt
 * -> issueBadge, same request, no human step) — the discussion format is the
 * only path where a badge waits on a person (ReviewService.decide); an
 * already-issued MCQ badge can still be retroactively revoked if the attempt
 * gets integrity-flagged, but that's a fraud check, not a precondition for
 * issuance. (2) Premium has no live payment integration (see
 * app/upgrade/page.tsx's own comment), so its answer deliberately doesn't
 * commit to a price.
 */
export const metadata: Metadata = {
  title: 'FAQ — MyAmbii',
  description: 'Frequently asked questions about MyAmbii — how verification works, and what it means for candidates and employers.',
};

const FAQS = [
  {
    q: 'How do the skill assessments work?',
    a: "MyAmbii verifies AI/ML skills two ways. Most assessments are multiple-choice tests: submit your answers and, if you pass, your score and badge are ready immediately — no person reviews it. For select skills, verification instead happens through a live, text-based conversation with an AI interviewer — no multiple choice, no visible score — and a person on our team reviews the conversation before that badge is issued. Either way, a badge always reflects a real assessment result: nothing is issued on a self-reported claim alone.",
  },
  {
    q: 'Is MyAmbii free for candidates?',
    a: 'Yes. Creating a profile, browsing and applying to jobs, and taking assessments to earn verified badges are all free, within monthly limits. Premium removes those limits at ₹299/month or ₹2,999/year.',
  },
  {
    q: 'How long does verification take?',
    a: "MCQ assessments return a score and, if you pass, a badge immediately. For assessments verified through a recorded conversation, there's no result until a person on our team has reviewed it — typically about a day.",
  },
  {
    q: 'How do employers use verified profiles?',
    a: "Employers can only search and view candidates who have at least one verified skill badge — unverified, self-reported claims are never shown or searchable. From there, employers move candidates through a hiring pipeline: shortlist, invite, interview rounds, offer, and outcome. Employers see your public profile and verified skills only — never your phone number, email, or unverified claim details — and photos/resumes are only shared once there's an active relationship (e.g. you've applied to their job).",
  },
  {
    q: 'Which AI skills and levels can I get verified?',
    a: 'MyAmbii covers AI/ML skills across areas like RAG systems, prompt engineering, LLM evaluation, fine-tuning, agentic systems, model deployment, and AI governance/security, at three levels: Foundational, Practitioner, and Advanced.',
  },
];

export default function FaqPage() {
  return (
    <main className="lp-page lp-faq-page" id="top">
      <div className="lp-container lp-faq-wrap">
        <BrandLockup variant="hero" href="/" ariaLabel="MyAmbii home" />

        <div className="lp-faq-panel">
          <p className="lp-section-eyebrow">FAQ</p>
          <h1 className="lp-section-title" style={{ marginBottom: 20 }}>
            Frequently asked questions
          </h1>
          <div className="lp-faq">
            {FAQS.map(({ q, a }) => (
              <details className="lp-faq-item" key={q}>
                <summary className="lp-faq-q">{q}</summary>
                <p className="lp-faq-a">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
