import type { Metadata } from 'next';
import LandingHeader from '@/components/landing/LandingHeader';

/**
 * Marketing landing page — served at the domain root ("/"). The candidate
 * sign-in that used to live here has moved to "/candidate" (a login-or-
 * dashboard entry mirroring "/employer"); an unauthenticated visitor to any
 * protected page is sent there, never to this marketing page. This lives in
 * the app codebase so it inherits the Nocturne tokens, the Logo component
 * and the bundled fonts — the header/hero styling is its own `.lp-*`
 * namespace in globals.css, kept apart from the app chrome.
 *
 * Sign-in targets: candidates go to "/candidate", employers to "/employer".
 * Both are relative by default (landing + app are the same Next deployment,
 * so a relative link resolves within it). If the app is ever served from a
 * different origin than the marketing domain, set NEXT_PUBLIC_APP_ORIGIN and
 * both links absolutize to it.
 */
const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN ?? '';
const CANDIDATE_HREF = `${APP_ORIGIN}/candidate`;
const EMPLOYER_HREF = `${APP_ORIGIN}/employer`;

export const metadata: Metadata = {
  title: 'SkillProof — Hire on proven AI skills, not keywords',
  description:
    'SkillProof verifies real AI ability through assessments reviewed by a person. Candidates get matched to roles that want their proven skills; employers hire on evidence, not keywords.',
};

/** Candidate value props — the substance is the candidate login rotator (AuthMessageRotator.tsx). */
const CAPABILITIES = [
  {
    title: 'Proof, not promises',
    body: 'Skills verified through a real assessment and reviewed by a person — evidence employers can independently check, not a self-reported tag.',
  },
  {
    title: 'A co-pilot for your next move',
    body: 'See exactly which skill is holding you back, and which roles open up once you prove it — guidance, not a black box.',
  },
  {
    title: 'Talk directly to companies hiring',
    body: 'No black-hole applications. Reach companies hiring for AI skills and track every interview, round and offer in one place.',
  },
  {
    title: 'Apply in minutes, not hours',
    body: 'Your verified profile does the work — no re-typing the same details into every application.',
  },
];

/** How verification works — drawn from existing positioning; no invented specifics (turnaround, pricing). */
const STEPS = [
  {
    num: '01',
    title: 'Take a rigorous assessment',
    body: 'Prove a skill through a written assessment or a live technical discussion — practical, not keyword trivia.',
  },
  {
    num: '02',
    title: 'Reviewed by a person',
    body: 'A human reviewer confirms the evidence behind every badge before it is issued — automated scores alone never issue one.',
  },
  {
    num: '03',
    title: 'Get matched, verifiably',
    body: 'Earn a shareable verified badge and a benchmarked profile. Employers search verified talent first and see exactly why you fit.',
  },
];

/** Employer-facing framing — substance from the employer login rotator (EmployerOtpLogin.tsx). */
const EMPLOYER_POINTS = [
  {
    title: 'Hire on evidence, not claims',
    body: "Every badge is earned through a real assessment and reviewed by a person before it's issued.",
  },
  {
    title: 'See who can actually do the work',
    body: 'Verified skills and levels on every profile, so you compare ability rather than CV keywords.',
  },
  {
    title: 'One place from shortlist to hire',
    body: 'Invite, assess, interview, offer and track — every stage visible to both sides, nothing lost in inboxes.',
  },
];

/**
 * FAQ answers are deliberate placeholders — real copy (how assessments work,
 * pricing, review turnaround) will be supplied and must not be invented here.
 */
const FAQS = [
  'How do the skill assessments work?',
  'Is SkillProof free for candidates?',
  'How long does verification take?',
  'How do employers use verified profiles?',
  'Which AI skills and levels can I get verified?',
];

export default function LandingPage() {
  return (
    <>
      <LandingHeader candidateHref={CANDIDATE_HREF} employerHref={EMPLOYER_HREF} />
      <main className="lp-page" id="top">
      {/* ---------- Hero ---------- */}
      <section className="lp-hero" aria-labelledby="lp-hero-heading">
        <div className="lp-hero-scrim" aria-hidden="true" />
        <div className="lp-container lp-hero-inner">
          <p className="lp-eyebrow">Verified AI talent</p>
          <h1 id="lp-hero-heading" className="lp-hero-title">
            Where proven AI skill meets the companies hiring for it
          </h1>
          <p className="lp-hero-sub">
            SkillProof turns real ability into verified proof — assessments reviewed by a person, not
            keyword-matched. Candidates get matched on evidence; employers hire on it.
          </p>

          <div className="lp-hero-ctas">
            <div className="lp-cta-block">
              <a className="lp-btn lp-btn-primary" href={CANDIDATE_HREF}>
                Prove your skills
              </a>
              <span className="lp-cta-caption">Prove your AI skills, get matched to roles that want them</span>
            </div>
            <div className="lp-cta-block">
              <a className="lp-btn lp-btn-secondary" href={EMPLOYER_HREF}>
                Hire on proven skills
              </a>
              <span className="lp-cta-caption">Hire on proven skills, not keywords</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Capabilities ---------- */}
      <section className="lp-section" aria-labelledby="lp-cap-heading">
        <div className="lp-container">
          <p className="lp-section-eyebrow">The platform</p>
          <h2 id="lp-cap-heading" className="lp-section-title">
            Everything a proven candidate needs — and nothing that wastes an employer&apos;s time
          </h2>
          <div className="lp-card-grid">
            {CAPABILITIES.map((c) => (
              <div className="lp-card" key={c.title}>
                <h3 className="lp-card-title">{c.title}</h3>
                <p className="lp-card-body">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How verification works ---------- */}
      <section className="lp-section lp-section-alt" aria-labelledby="lp-how-heading">
        <div className="lp-container">
          <p className="lp-section-eyebrow">How verification works</p>
          <h2 id="lp-how-heading" className="lp-section-title">
            From claim to proof, with a person in the loop
          </h2>
          <div className="lp-steps">
            {STEPS.map((s) => (
              <div className="lp-step" key={s.num}>
                <span className="lp-step-num">{s.num}</span>
                <h3 className="lp-step-title">{s.title}</h3>
                <p className="lp-step-body">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- For employers ---------- */}
      <section className="lp-section" aria-labelledby="lp-emp-heading">
        <div className="lp-container">
          <p className="lp-section-eyebrow">For employers</p>
          <h2 id="lp-emp-heading" className="lp-section-title">
            Stop screening keywords. Start reading proof.
          </h2>
          <div className="lp-card-grid lp-card-grid-3">
            {EMPLOYER_POINTS.map((p) => (
              <div className="lp-card" key={p.title}>
                <h3 className="lp-card-title">{p.title}</h3>
                <p className="lp-card-body">{p.body}</p>
              </div>
            ))}
          </div>
          <div className="lp-inline-cta">
            <a className="lp-btn lp-btn-secondary" href={EMPLOYER_HREF}>
              Go to the employer portal
            </a>
          </div>
        </div>
      </section>

      {/* ---------- About ---------- */}
      <section className="lp-section lp-section-alt" id="about" aria-labelledby="lp-about-heading">
        <div className="lp-container lp-prose">
          <p className="lp-section-eyebrow">About</p>
          <h2 id="lp-about-heading" className="lp-section-title">
            Built to make AI skill legible
          </h2>
          <p className="lp-prose-body">
            SkillProof is a product of <strong>Mukaab Technologies Private Limited</strong>. We believe hiring for
            AI should rest on demonstrated ability rather than keywords on a résumé — so we verify skills through
            real assessments, put a person in the loop before any badge is issued, and give employers evidence they
            can check.
          </p>
        </div>
      </section>

      {/* ---------- Contact ---------- */}
      <section className="lp-section" id="contact" aria-labelledby="lp-contact-heading">
        <div className="lp-container lp-prose">
          <p className="lp-section-eyebrow">Contact</p>
          <h2 id="lp-contact-heading" className="lp-section-title">
            Get in touch
          </h2>
          <p className="lp-prose-body">
            <span className="lp-placeholder-tag">Placeholder</span> Contact details will be published here. Content
            to be supplied.
          </p>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="lp-section lp-section-alt" id="faq" aria-labelledby="lp-faq-heading">
        <div className="lp-container lp-prose">
          <p className="lp-section-eyebrow">FAQ</p>
          <h2 id="lp-faq-heading" className="lp-section-title">
            Frequently asked questions
          </h2>
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
      </section>

      </main>

      {/* ---------- Footer ---------- */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="brand-product-name">SkillProof</span>
            <p className="lp-footer-company">Mukaab Technologies Private Limited</p>
            <p className="lp-footer-copy">© {new Date().getFullYear()} Mukaab Technologies Private Limited</p>
          </div>
          <nav className="lp-footer-links" aria-label="Footer">
            <a href="#about">About Us</a>
            <a href="#contact">Contact</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
            <a href="#faq">FAQs</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
