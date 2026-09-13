'use client';

/**
 * /help — two guides (candidate, employer) behind an audience tab reflected
 * in the URL as ?audience=candidates|employers, so a link can point at a
 * specific guide and the browser back button steps through tab switches
 * (router.push, not replace — each tab click is its own history entry,
 * same as EmployerShortlist's own query-param-seeded state).
 *
 * Chrome borrows LegalDocument's shape (BrandLockup, centred column,
 * .lp-legal-body content typography) rather than reusing that component
 * directly — LegalDocument is built for exactly one document as `children`,
 * with no tab state of its own; forcing two guides and a tab bar through it
 * would mean bending a single-document component rather than reusing it.
 * Same min-height: 100vh (never height) as every other standalone page here
 * — see globals.css's own comment on why, tracing back to the auth-layout
 * clipping fix.
 *
 * Deliberately no way back into the app (2026-09): every entry point
 * (CandidateNav, EmployerSidebarShell, the landing footer, /faq) opens this
 * page in its own named browser tab (target="myambii-help") rather than
 * navigating the current one, so there's no "back to main site" link, no
 * breadcrumb, and BrandLockup renders with no `href` — a plain, static
 * mark, same as OAuthCallback's own non-linked lockup, not a link home. The
 * page reads as a standalone document the user closes when done, not a
 * section of the app they need to navigate out of.
 *
 * Also exempt in lib/candidateVerification.tsx's GATE_EXEMPT_PATH_PREFIXES
 * — that provider redirects an incomplete-verification candidate to
 * /verify on any non-exempt route, which would otherwise hijack this tab
 * the moment it opened for exactly the candidates most likely to need it
 * (OAuth signups missing a phone number).
 *
 * No sign-in check anywhere in this file or its parent page — both guides
 * must be reachable by a prospective candidate or employer before they have
 * an account.
 */
import { useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BrandLockup from '../BrandLockup';
import CandidateHelpGuide, { CANDIDATE_HELP_SECTIONS } from './CandidateHelpGuide';
import EmployerHelpGuide, { EMPLOYER_HELP_SECTIONS } from './EmployerHelpGuide';

type Audience = 'candidates' | 'employers';

export default function HelpTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const audience: Audience = searchParams.get('audience') === 'employers' ? 'employers' : 'candidates';

  const setAudience = useCallback(
    (next: Audience) => {
      if (next === audience) return;
      router.push(`/help?audience=${next}`);
    },
    [audience, router],
  );

  const sections = audience === 'candidates' ? CANDIDATE_HELP_SECTIONS : EMPLOYER_HELP_SECTIONS;

  return (
    <main className="lp-page lp-help-page">
      <div className="lp-container lp-help-wrap">
        <BrandLockup variant="hero" />

        <header className="lp-help-header">
          <h1 className="lp-help-title">Help</h1>
        </header>

        <div className="lp-help-tabs" role="tablist" aria-label="Help guide audience">
          <button
            type="button"
            role="tab"
            id="help-tab-candidates"
            aria-selected={audience === 'candidates'}
            aria-controls="help-panel"
            className={`lp-help-tab${audience === 'candidates' ? ' is-active' : ''}`}
            onClick={() => setAudience('candidates')}
          >
            Candidates
          </button>
          <button
            type="button"
            role="tab"
            id="help-tab-employers"
            aria-selected={audience === 'employers'}
            aria-controls="help-panel"
            className={`lp-help-tab${audience === 'employers' ? ' is-active' : ''}`}
            onClick={() => setAudience('employers')}
          >
            Employers
          </button>
        </div>

        <nav className="lp-help-toc" aria-label="Guide sections">
          <p className="lp-help-toc-title">On this page</p>
          <ul className="lp-help-toc-list">
            {sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.label}</a></li>
            ))}
          </ul>
        </nav>

        <article
          id="help-panel"
          role="tabpanel"
          aria-labelledby={audience === 'candidates' ? 'help-tab-candidates' : 'help-tab-employers'}
          className="lp-legal-body"
        >
          {audience === 'candidates' ? <CandidateHelpGuide /> : <EmployerHelpGuide />}
        </article>

        <p className="lp-legal-footer">Mukaab Technologies Private Ltd.</p>
      </div>
    </main>
  );
}
