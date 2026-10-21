'use client';

/**
 * Persistent candidate nav. Desktop/tablet: glass icon tiles with labels in
 * the header. Phones (<=760px): the header keeps only the logo + account
 * menu, and the main sections move to a fixed bottom bar with icon + label —
 * seven tiles don't fit across a phone, and icon-only tiles were guesswork.
 * Help (and Upgrade for FREE) live in the account menu on phones instead.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, logout } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { initialsFrom } from '@/lib/initials';
import BrandLockup from './BrandLockup';
import AccountMenu, { type AccountMenuItem } from './AccountMenu';
import NavGlyph, { type NavGlyphName } from './NavGlyphs';

const LINKS: { href: string; label: string; icon: NavGlyphName; newTab?: boolean }[] = [
  { href: '/candidate', label: 'Dashboard', icon: 'dashboard' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
  { href: '/assessments', label: 'Assessments', icon: 'assessments' },
  { href: '/jobs', label: 'Jobs', icon: 'jobs' },
  { href: '/interviews', label: 'Interviews', icon: 'interviews' },
  // Opens in its own named tab, never this one — see HelpGuidePage.tsx's
  // own doc comment on why the help pages carry no way back into the app.
  { href: '/help/candidate', label: 'Help', icon: 'help', newTab: true },
];

const BOTTOM_LINKS = LINKS.filter((l) => !l.newTab);

interface Props {
  /** Optional: pages guarded by useRequireAuth don't need local teardown — the redirect below already handles it. */
  onLoggedOut?: () => void;
}

export default function CandidateNav({ onLoggedOut }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { tier } = useEntitlements();
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    api<{ fullName: string | null }>('/profiles/me')
      .then((p) => setFullName(p.fullName))
      .catch(() => undefined);
  }, []);

  // Navigate explicitly so logout always lands on the login screen, from any
  // tab, on any route; tokens are cleared (awaited) first.
  async function handleLogout() {
    await logout();
    onLoggedOut?.();
    router.replace('/candidate');
  }

  const menuItems: AccountMenuItem[] = [
    { label: 'Profile', href: '/profile', icon: 'profile' },
    { label: 'Account', href: '/profile/account', icon: 'settings' },
    { label: 'Help', href: '/help/candidate', target: 'myambii-help', rel: 'noopener', icon: 'help', mobileOnly: true },
    ...(tier === 'FREE'
      ? [{ label: 'Upgrade', href: '/upgrade', icon: 'upgrade' as NavGlyphName, mobileOnly: true }]
      : []),
    { label: 'Log out', onClick: handleLogout, icon: 'logout' },
  ];

  return (
    <>
      <div className="appnav">
        <div className="appnav-inner">
          <BrandLockup variant="nav" href="/candidate" />
          <div className="appnav-links">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  target={l.newTab ? 'myambii-help' : undefined}
                  rel={l.newTab ? 'noopener' : undefined}
                  className={`nav-glass${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                  title={l.label}
                >
                  <span className="nav-glass-tile">
                    <NavGlyph name={l.icon} />
                  </span>
                  <span className="nav-glass-label">{l.label}</span>
                </Link>
              );
            })}
            {tier === 'FREE' && (
              <Link href="/upgrade" className="nav-glass nav-glass-upgrade" title="Upgrade">
                <span className="nav-glass-tile">
                  <NavGlyph name="upgrade" />
                </span>
                <span className="nav-glass-label">Upgrade</span>
              </Link>
            )}
            <AccountMenu
              label={fullName ?? 'Account'}
              initials={fullName ? initialsFrom(fullName) : undefined}
              items={menuItems}
            />
          </div>
        </div>
      </div>

      {/* Phones only (see globals.css) — the header links above hide at the same width. */}
      <nav className="appnav-bottom" aria-label="Main">
        {BOTTOM_LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`appnav-bottom-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="appnav-bottom-tile">
                <NavGlyph name={l.icon} />
              </span>
              <span className="appnav-bottom-label">{l.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
