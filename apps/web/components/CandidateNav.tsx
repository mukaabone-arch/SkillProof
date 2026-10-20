'use client';

/** Persistent nav across the main candidate areas — glass icon tiles with a small label, clear active state. */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, logout } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { initialsFrom } from '@/lib/initials';
import BrandLockup from './BrandLockup';
import AccountMenu from './AccountMenu';
import NavGlyph, { type NavGlyphName } from './NavGlyphs';

const LINKS: { href: string; label: string; icon: NavGlyphName; newTab?: boolean }[] = [
  { href: '/candidate', label: 'Dashboard', icon: 'dashboard' },
  { href: '/profile', label: 'Profile', icon: 'profile' },
  { href: '/assessments', label: 'Assessments', icon: 'assessments' },
  { href: '/jobs', label: 'Jobs', icon: 'jobs' },
  { href: '/interviews', label: 'Interviews', icon: 'interviews' },
  // Opens in its own named tab, never this one — see HelpGuidePage.tsx's
  // own doc comment on why the help pages carry no way back into the app.
  // Never the `active` link below as a result: pathname in this tab can
  // never actually become /help/candidate.
  { href: '/help/candidate', label: 'Help', icon: 'help', newTab: true },
];

interface Props {
  /** Optional: pages guarded by useRequireAuth don't need local teardown — the redirect below already handles it. */
  onLoggedOut?: () => void;
}

export default function CandidateNav({ onLoggedOut }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { tier } = useEntitlements();
  // Just the name, for the account menu's initials — this nav otherwise has
  // no reason to fetch the profile at all.
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    api<{ fullName: string | null }>('/profiles/me')
      .then((p) => setFullName(p.fullName))
      .catch(() => undefined);
  }, []);

  // Navigate explicitly so logout always lands on the login screen, from any
  // tab, on any route. Tokens must be cleared (awaited) before navigating so
  // the destination page's own getToken() check sees the logged-out state.
  async function handleLogout() {
    await logout();
    onLoggedOut?.();
    router.replace('/candidate');
  }

  return (
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
            items={[
              { label: 'Profile', href: '/profile' },
              { label: 'Account', href: '/profile/account' },
              { label: 'Log out', onClick: handleLogout },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
