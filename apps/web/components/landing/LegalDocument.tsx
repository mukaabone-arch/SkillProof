import type { ReactNode } from 'react';
import BrandLockup from '../BrandLockup';

/**
 * Shared chrome for a real (non-stub) legal document — BrandLockup header,
 * title, visible "Last updated" date, and a readable-width column for the
 * body. Replaces LegalStub for /privacy and /terms now that both have real
 * content; LegalStub itself is untouched and still covers any future legal
 * route that doesn't have copy yet. Same shared-chrome/separate-content
 * relationship as app/contact/page.tsx and app/faq/page.tsx: this owns the
 * layout, each page supplies its own body JSX as children.
 *
 * `lastUpdated` is rendered as its own visible line under the title (not
 * left as an italic paragraph inside the body, which is how both source
 * documents format it) — same reasoning FAQ already established for using
 * native <details>/<summary> instead of styled divs: semantic, visible
 * structure over markdown-literal styling.
 */
interface Props {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}

export default function LegalDocument({ title, lastUpdated, children }: Props) {
  return (
    <main className="lp-page lp-legal-page">
      <div className="lp-container lp-legal-wrap">
        <BrandLockup variant="hero" href="/" ariaLabel="MyAmbii home" />
        <header className="lp-legal-header">
          <h1 className="lp-legal-title">{title}</h1>
          <p className="lp-legal-updated">Last updated: {lastUpdated}</p>
        </header>
        <article className="lp-legal-body">{children}</article>
        <p className="lp-legal-footer">Mukaab Technologies Private Ltd.</p>
      </div>
    </main>
  );
}
