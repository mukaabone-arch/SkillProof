/**
 * The headline strip at the top of the employer dashboard and the recruiter
 * Find talent page: what the section is (eyebrow), MyAmbii's promise
 * (headline), and the proof behind it (the "verified" tag). Replaces the bare
 * page title, so every visit restates why the shortlist can be trusted.
 */
import type { ReactNode } from 'react';

interface Props {
  eyebrow: string;
  title: string;
  tag?: string;
  children?: ReactNode;
}

export default function PortalHeadline({ eyebrow, title, tag = 'Skills verified through timed assessments and AI discussions', children }: Props) {
  return (
    <header className="portal-headline">
      <p className="portal-headline-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="portal-headline-tag">
        <svg width="1.1em" height="1.1em" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M7.5 12.3 L10.5 15.2 L16.5 9.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {tag}
      </p>
      {children}
    </header>
  );
}
