'use client';

/**
 * A settings card that collapses to one row — title, a short status, and a
 * chevron — and expands in place. Used on /profile/account so the page reads
 * as a scannable list ("Login methods · Email and phone added") instead of a
 * wall of explanation, with the detail one tap away.
 *
 * Native <details>/<summary>, so it's keyboard- and screen-reader-accessible
 * for free. Open state is mirrored in React (onToggle) so a component that
 * re-renders never snaps it shut, and children stay mounted while collapsed —
 * a half-finished flow (e.g. waiting for an OTP) survives closing and
 * reopening the section.
 *
 * Deep links: arriving with #<id> in the URL (e.g. the dashboard's "Add your
 * phone" nudge -> /profile/account#login-methods) opens that section and
 * scrolls to it, including on in-page hash changes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Anchor id — also what a #hash deep link opens. */
  id?: string;
  /** Usually plain text; the profile page passes photo + name. */
  title: ReactNode;
  /** One short line shown next to the title while collapsed, e.g. "2 passkeys". */
  status?: ReactNode;
  /** 'danger' keeps the red border (Delete my account) so it still reads as destructive. */
  tone?: 'default' | 'danger';
  defaultOpen?: boolean;
  children: ReactNode;
}

export default function CollapsibleSection({ id, title, status, tone = 'default', defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!id) return;
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}`) {
        setOpen(true);
        // After the open re-render, so the scroll lands on the expanded card.
        requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    };
    openIfTargeted();
    window.addEventListener('hashchange', openIfTargeted);
    return () => window.removeEventListener('hashchange', openIfTargeted);
  }, [id]);

  return (
    <details
      ref={ref}
      id={id}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className={`ui-card collapsible-section${tone === 'danger' ? ' collapsible-section-danger' : ''}`}
    >
      <summary>
        <span className="collapsible-section-title">{title}</span>
        {status && <span className="collapsible-section-status">{status}</span>}
      </summary>
      <div className="collapsible-section-body">{children}</div>
    </details>
  );
}
