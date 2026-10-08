'use client';

/**
 * Shared account control for both portal headers — candidate's .appnav and
 * the employer's .employer-topbar. See globals.css's "shared dark header
 * theme" comment: restyle the header once, here, and both portals follow;
 * this is the same reasoning applied to a component instead of a token.
 * The control (avatar trigger -> dropdown) is identical in both; only
 * `items` differs (CandidateNav: Profile/Account/Log out; employer
 * EmployerSidebarShell: Settings/Billing/Team members/Log out).
 *
 * Previously a bare "Log out" button (.appnav-logout) — the single most
 * emphasised control in either header, because there was nothing else to
 * look at. This demotes sign-out to one item among several, behind a
 * click, instead of the header's only affordance.
 *
 * `initials` is optional and deliberately not defaulted to anything
 * fabricated: pass it only when the caller actually has a name to derive
 * it from (see lib/initials.ts). With none, the trigger shows a generic
 * account glyph rather than guessing.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface AccountMenuItem {
  label: string;
  href?: string;
  target?: string;
  rel?: string;
  /** For an action item (Log out) rather than a link. */
  onClick?: () => void;
}

interface Props {
  initials?: string;
  /** Accessible name for the trigger — the person's or org's display name, used as "{label} menu". */
  label: string;
  items: AccountMenuItem[];
}

export default function AccountMenu({ initials, label, items }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} menu`}
        onClick={() => setOpen((v) => !v)}
      >
        {initials || (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="5.5" r="2.5" fill="currentColor" />
            <path d="M2.5 14c0-2.76 2.46-5 5.5-5s5.5 2.24 5.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {open && (
        <div className="account-menu-dropdown" role="menu">
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                target={item.target}
                rel={item.rel}
                className="account-menu-item"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="account-menu-item"
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
