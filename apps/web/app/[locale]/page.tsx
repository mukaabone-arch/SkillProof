import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import LandingHeader from '@/components/landing/LandingHeader';
import NewsStrip from '@/components/landing/NewsStrip';
import ConsentSettingsLink from '@/components/ConsentSettingsLink';
import BrandLockup from '@/components/BrandLockup';
import BetaPromoScroll from '@/components/BetaPromoScroll';
import LocaleSwitcher from '@/components/LocaleSwitcher';
import { localeAlternates } from '@/lib/localeMetadata';
import type { Locale } from '@/i18n/routing';

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
const STAFFING_HREF = `${APP_ORIGIN}/staffing`;

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'meta.landing' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localeAlternates(locale as Locale, '/'),
  };
}

/**
 * Candidate value props — headings only (the substance is the candidate
 * login rotator, AuthMessageRotator.tsx). Rendered as a compact row of
 * heading-only feature cards; see .lp-card-feature in globals.css.
 * Keys into messages `landing.platform.items`.
 */
const CAPABILITY_KEYS = ['proof', 'copilot', 'direct', 'apply'] as const;

/**
 * How verification works — numbered step markers + headings only (drawn from
 * existing positioning; no invented specifics like turnaround or pricing).
 * Rendered as compact cards; see .lp-step in globals.css. Keys into messages
 * `landing.how.steps`; the numerals are not translated.
 */
const STEP_KEYS = ['assess', 'verified', 'matched'] as const;

/**
 * Employer-facing framing — headings only (substance from the employer login
 * rotator, EmployerOtpLogin.tsx). Rendered as compact heading-only cards, the
 * same .lp-card-feature treatment as the platform strip. Keys into messages
 * `landing.employers.points`.
 */
const EMPLOYER_POINT_KEYS = ['evidence', 'doers', 'oneplace'] as const;

export default function LandingPage({ params: { locale } }: { params: { locale: string } }) {
  // Required for static rendering of this page per locale (next-intl).
  setRequestLocale(locale);
  const t = useTranslations();
  return (
    <>
      <LandingHeader candidateHref={CANDIDATE_HREF} employerHref={EMPLOYER_HREF} staffingHref={STAFFING_HREF} />
      <main className="lp-page" id="top">
      {/* ---------- Hero ---------- */}
      <section className="lp-hero" aria-labelledby="lp-hero-heading">
        <div className="lp-hero-scrim" aria-hidden="true" />
        <div className="lp-container lp-hero-inner">
          <BetaPromoScroll />
          <p className="lp-eyebrow">{t('landing.hero.eyebrow')}</p>
          {/* Two headline variants, toggled by CSS at 768px (see .lp-hero-title-lg/-sm
              in globals.css). Desktop keeps the full line (3 balanced lines over the
              empty left of the landscape shot); mobile uses a shorter one that fits two
              lines and lifts the text block off the subjects' faces, which share the
              clear-middle band of the scrim. Exactly one span is display:none at any
              width, so only one contributes to the h1's accessible name. */}
          <h1 id="lp-hero-heading" className="lp-hero-title">
            <span className="lp-hero-title-lg">{t('landing.hero.titleLg')}</span>
            <span className="lp-hero-title-sm">{t('landing.hero.titleSm')}</span>
          </h1>
          <p className="lp-hero-sub">{t('landing.hero.sub')}</p>

          <div className="lp-hero-ctas">
            <div className="lp-cta-block">
              <a className="lp-btn lp-btn-primary" href={CANDIDATE_HREF}>
                {t('landing.hero.candidateCta')}
              </a>
              <span className="lp-cta-caption">{t('landing.hero.candidateCaption')}</span>
            </div>
            <div className="lp-cta-block">
              <a className="lp-btn lp-btn-secondary" href={EMPLOYER_HREF}>
                {t('landing.hero.employerCta')}
              </a>
              <span className="lp-cta-caption">{t('landing.hero.employerCaption')}</span>
            </div>
            <p className="lp-cta-alt">
              {t.rich('landing.hero.recruiterLine', { link: (chunks) => <a href={STAFFING_HREF}>{chunks}</a> })}
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Capabilities ---------- */}
      <section className="lp-section" aria-labelledby="lp-cap-heading">
        <div className="lp-container">
          <p className="lp-section-eyebrow">{t('landing.platform.eyebrow')}</p>
          <h2 id="lp-cap-heading" className="lp-section-title">
            {t('landing.platform.title')}
          </h2>
          <div className="lp-card-grid lp-card-grid-features">
            {CAPABILITY_KEYS.map((key, i) => (
              <div className="lp-card lp-card-feature" key={key}>
                <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="lp-card-title">{t(`landing.platform.items.${key}`)}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How verification works ---------- */}
      <section className="lp-section lp-section-alt" aria-labelledby="lp-how-heading">
        <div className="lp-container">
          <p className="lp-section-eyebrow">{t('landing.how.eyebrow')}</p>
          <h2 id="lp-how-heading" className="lp-section-title">
            {t('landing.how.title')}
          </h2>
          <div className="lp-steps">
            {STEP_KEYS.map((key, i) => (
              <div className="lp-step" key={key}>
                <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="lp-step-title">{t(`landing.how.steps.${key}`)}</h3>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- For employers ---------- */}
      <section className="lp-section" aria-labelledby="lp-emp-heading">
        <div className="lp-container">
          <p className="lp-section-eyebrow">{t('landing.employers.eyebrow')}</p>
          <h2 id="lp-emp-heading" className="lp-section-title">
            {t('landing.employers.title')}
          </h2>
          <div className="lp-card-grid lp-card-grid-3">
            {EMPLOYER_POINT_KEYS.map((key, i) => (
              <div className="lp-card lp-card-feature" key={key}>
                <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="lp-card-title">{t(`landing.employers.points.${key}`)}</h3>
              </div>
            ))}
          </div>
          <div className="lp-inline-cta">
            <a className="lp-btn lp-btn-secondary" href={EMPLOYER_HREF}>
              {t('landing.employers.cta')}
            </a>
          </div>
        </div>
      </section>

      {/* ---------- AI news strip — below the fold, after both CTAs, renders nothing if there's nothing cached (see NewsStrip's own doc comment) ---------- */}
      <NewsStrip />

      {/* ---------- About ---------- */}
      <section className="lp-section lp-section-alt" id="about" aria-labelledby="lp-about-heading">
        <div className="lp-container lp-prose">
          <p className="lp-section-eyebrow">{t('landing.about.eyebrow')}</p>
          <h2 id="lp-about-heading" className="lp-section-title">
            {t('landing.about.title')}
          </h2>
          <p className="lp-prose-body">
            {t.rich('landing.about.body', { strong: (chunks) => <strong>{chunks}</strong> })}
          </p>
        </div>
      </section>

      </main>

      {/* ---------- Footer ---------- */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-footer-lockup">
              <BrandLockup variant="hero" />
            </div>
            <p className="lp-footer-flair" aria-label="flAIr future Intelligence">
              fl<span className="lp-flair-ai">AI</span>r future <span className="lp-flair-int">Intelligence</span>
            </p>
            <p className="lp-footer-company">{t('footer.company')}</p>
            <p className="lp-footer-copy">{t('footer.copy', { year: String(new Date().getFullYear()) })}</p>
          </div>
          <nav className="lp-footer-links" aria-label={t('footer.label')}>
            <a href="#about">{t('footer.about')}</a>
            <a href="/contact">{t('footer.contact')}</a>
            <a href="/privacy" target="_blank" rel="noopener noreferrer">{t('footer.privacy')}</a>
            <a href="/terms" target="_blank" rel="noopener noreferrer">{t('footer.terms')}</a>
            <a href="/refunds" target="_blank" rel="noopener noreferrer">{t('footer.refunds')}</a>
            <a href="/account-deletion" target="_blank" rel="noopener noreferrer">{t('footer.delete')}</a>
            <a href="/faq">{t('footer.faq')}</a>
            <LocaleSwitcher />
            <ConsentSettingsLink />
          </nav>
        </div>
      </footer>
    </>
  );
}
