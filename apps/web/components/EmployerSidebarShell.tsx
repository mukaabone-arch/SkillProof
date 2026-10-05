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
 *
 * data-theme="light" on the root div (2026-09) scopes the employer-portal
 * light theme — see the "employer portal: light theme" block in
 * globals.css. Every page rendered as `children` inherits it; nothing
 * outside this shell (candidate/public/admin) is affected.
 *
 * `verified` (2026-09) hides every section but Settings while the org's
 * platform-admin verification is anything but VERIFIED — the client-side
 * courtesy half of the verification gate; OrgVerifiedGuard is the real,
 * server-side enforcement (see app/employer/layout.tsx's own doc comment).
 * Settings always stays — it's the one place a non-verified org can check
 * status, fix its details, or wait.
 *
 * Help (2026-09) is rendered separately from SECTIONS, after the `verified`
 * filter runs, and is never itself filtered — it's not part of the
 * portal-proper gate at all (it's a public, no-sign-in-required route, see
 * app/help/employer/page.tsx), so an org stuck on Settings still needs a way to it.
 * Opens in its own named tab (target="myambii-help") rather than
 * navigating this shell away — the help pages are meant to stand alone,
 * not be reached by leaving the portal.
 */
import { useRouter } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { isLocalizedPath } from '@/i18n/routing';
import { employerApi } from '@/lib/api';
import BrandLockup from './BrandLockup';

/** `label` is a key under employerShell.nav. */
const SECTIONS = [
  { href: '/employer/dashboard', label: 'dashboard' },
  { href: '/employer/jobs', label: 'jobs' },
  { href: '/employer/candidates', label: 'candidates' },
  { href: '/employer/applicants', label: 'applicants' },
  { href: '/employer/shortlist', label: 'shortlist' },
  { href: '/employer/billing', label: 'billing' },
  { href: '/employer/settings', label: 'settings' },
];

interface Props {
  verified: boolean;
  onLoggedOut: () => void;
  children: React.ReactNode;
}

export default function EmployerSidebarShell({ verified, onLoggedOut, children }: Props) {
  const t = useTranslations('employerShell');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const verifiedSections = verified ? SECTIONS : SECTIONS.filter((s) => s.href === '/employer/settings');
  // Under Arabic, a link to an untranslated page would drop the walkthrough
  // into English mid-session (middleware sends /ar/<untranslated> to English).
  // Show only the sections that have an Arabic version. Help opens a separate
  // English tab, so it is hidden under Arabic too.
  const sections = locale === 'ar' ? verifiedSections.filter((s) => isLocalizedPath(s.href)) : verifiedSections;
  const showHelp = locale !== 'ar';

  async function handleLogout() {
    await employerApi.logout();
    onLoggedOut();
    router.replace('/employer');
  }

  return (
    <div className="employer-shell" data-theme="light">
      <header className="employer-topbar">
        <button
          type="button"
          className="employer-nav-toggle"
          aria-label={t('toggleNav')}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <BrandLockup variant="nav" href="/employer/dashboard" />
        <button type="button" className="appnav-logout" onClick={handleLogout}>{t('logout')}</button>
      </header>
      <div className="employer-body">
        <nav className={mobileOpen ? 'employer-sidebar is-open' : 'employer-sidebar'}>
          {sections.map((s) => {
            const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={active ? 'active' : ''}
                onClick={() => setMobileOpen(false)}
              >
                {t(`nav.${s.label}`)}
              </Link>
            );
          })}
          {/* Ungated — see this file's own doc comment on why Help sits
              outside the `verified` filter above. Opens in its own named
              tab (never this one) — see HelpGuidePage.tsx's own doc comment
              on why the help pages carry no way back into the app. */}
          {showHelp && (
            <Link href="/help/employer" target="myambii-help" rel="noopener" onClick={() => setMobileOpen(false)}>
              {t('help')}
            </Link>
          )}
          {/* Duplicate of the topbar's own Log out button — CSS shows exactly
              one of the two at any width (see .employer-sidebar-logout). */}
          <button type="button" className="employer-sidebar-logout" onClick={handleLogout}>
            {t('logout')}
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
