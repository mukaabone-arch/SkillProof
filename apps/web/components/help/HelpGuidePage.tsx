import BrandLockup from '../BrandLockup';
import MarkdownGuide from './MarkdownGuide';
import type { HelpSection } from '@/lib/helpGuideSource';

/**
 * Chrome shared by /help/candidate and /help/employer — the two guides now
 * live at their own routes rather than behind an audience tab, so a
 * candidate opening help from the candidate portal never sees employer
 * topics and vice versa.
 *
 * Note this is a Server Component, unlike the HelpTabs it replaces.
 * HelpTabs was 'use client' for exactly one reason — useSearchParams, to
 * read ?audience= — and splitting the routes removes that need entirely.
 * No client bundle, no Suspense boundary, no tab state.
 *
 * Chrome borrows LegalDocument's shape (BrandLockup, centred column,
 * .lp-legal-body content typography) rather than reusing that component
 * directly — LegalDocument is built for exactly one document as `children`
 * with no table of contents of its own.
 *
 * Deliberately no way back into the app (2026-09): every entry point opens
 * help in its own named browser tab (target="myambii-help") rather than
 * navigating the current one, so there's no "back to main site" link, no
 * breadcrumb, and BrandLockup renders with no `href` — a plain, static
 * mark, not a link home. The page reads as a standalone document the user
 * closes when done.
 *
 * No sign-in check here or in either route — both guides must be reachable
 * before someone has an account. That matters most for candidates, who
 * arrive from an employer's assessment request and need to know what
 * they're agreeing to before signing up, but the employer guide is public
 * for the same reason in reverse: employers evaluate before they register.
 */
export default function HelpGuidePage({
  title,
  markdown,
  sections,
}: {
  title: string;
  markdown: string;
  sections: HelpSection[];
}) {
  return (
    <main className="lp-page lp-help-page">
      <div className="lp-container lp-help-wrap">
        <BrandLockup variant="hero" />

        <header className="lp-help-header">
          <h1 className="lp-help-title">{title}</h1>
        </header>

        <nav className="lp-help-toc" aria-label="Guide sections">
          <p className="lp-help-toc-title">On this page</p>
          <ul className="lp-help-toc-list">
            {sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`}>{s.label}</a></li>
            ))}
          </ul>
        </nav>

        <article className="lp-legal-body">
          <MarkdownGuide markdown={markdown} />
        </article>

        <p className="lp-legal-footer">Mukaab Technologies Private Ltd.</p>
      </div>
    </main>
  );
}
