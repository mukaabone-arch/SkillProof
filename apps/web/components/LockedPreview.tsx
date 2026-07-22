'use client';

/**
 * The canonical locked-state pattern (see the task's own framing: "4
 * employers viewed your profile" with details blurred behind an upgrade
 * CTA) — used everywhere a Premium feature should be *visible but
 * withheld* rather than absent. Absence doesn't convert; a real, specific
 * teaser does. `teaser` is always real data (e.g. a genuine count), never
 * a hardcoded marketing line — it's what makes the locked state feel
 * concrete rather than a generic paywall.
 */
import { ReactNode } from 'react';
import Link from 'next/link';

interface LockedPreviewProps {
  teaser: ReactNode;
  children: ReactNode;
  ctaLabel?: string;
}

export function LockedPreview({ teaser, children, ctaLabel = 'Upgrade to see who' }: LockedPreviewProps) {
  return (
    <div className="locked-preview">
      <p className="locked-preview-teaser">{teaser}</p>
      <div className="locked-preview-content">
        <div className="locked-preview-blur" aria-hidden="true">
          {children}
        </div>
        <div className="locked-preview-overlay">
          <Link href="/upgrade">
            <button>{ctaLabel}</button>
          </Link>
        </div>
      </div>
    </div>
  );
}
