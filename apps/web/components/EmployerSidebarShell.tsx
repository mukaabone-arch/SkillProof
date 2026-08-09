'use client';

/**
 * Employer portal shell: slim topbar (brand + Log out) and a left sidebar
 * for section navigation, replacing the old top-nav-only EmployerNav for
 * every authenticated employer route. Candidate/admin nav (CandidateNav/
 * AdminNav, and the .appnav* classes they share with the old EmployerNav)
 * are untouched — this shell uses its own class names throughout so it
 * never inherits or fights their responsive rules (notably the
 * globals.css rule that hides .appnav-links below 720px, which would
 * otherwise leave employers with no nav at all on mobile).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { employerApi } from '@/lib/api';
import Logo from './Logo';

const SECTIONS = [
  { href: '/employer/dashboard', label: 'Dashboard' },
  { href: '/employer/jobs', label: 'Job Postings' },
  { href: '/employer/candidates', label: 'Find Candidates' },
  { href: '/employer/applicants', label: 'Applicants' },
  { href: '/employer/shortlist', label: 'Shortlist' },
  { href: '/employer/settings', label: 'Settings' },
];

interface Props {
  onLoggedOut: () => void;
  children: React.ReactNode;
}

export default function EmployerSidebarShell({ onLoggedOut, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await employerApi.logout();
    onLoggedOut();
    router.replace('/employer');
  }

  return (
    <div className="employer-shell">
      <header className="employer-topbar">
        <button
          type="button"
          className="employer-nav-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <Link href="/employer/dashboard" className="appnav-logo">
          <Logo className="brand-logo" />
          <span className="brand-product-name">SkillProof</span>
        </Link>
        <button type="button" className="appnav-logout" onClick={handleLogout}>Log out</button>
      </header>
      <div className="employer-body">
        <nav className={mobileOpen ? 'employer-sidebar is-open' : 'employer-sidebar'}>
          {SECTIONS.map((s) => {
            const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={active ? 'active' : ''}
                onClick={() => setMobileOpen(false)}
              >
                {s.label}
              </Link>
            );
          })}
          {/* Duplicate of the topbar's own Log out button — CSS shows exactly
              one of the two at any width (see .employer-sidebar-logout). */}
          <button type="button" className="employer-sidebar-logout" onClick={handleLogout}>
            Log out
          </button>
        </nav>
        {mobileOpen && (
          <div
            className="employer-sidebar-scrim"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}
        <div className="employer-content">{children}</div>
      </div>
    </div>
  );
}
