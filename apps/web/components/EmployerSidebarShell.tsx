'use client';

/**
 * Employer portal shell: slim topbar and a left sidebar for section
 * navigation, replacing the old top-nav-only EmployerNav for every
 * authenticated employer route. Candidate/admin nav (CandidateNav/AdminNav,
 * and the .appnav* classes they share with the old EmployerNav) are
 * untouched — this shell uses its own class names throughout so it never
 * inherits or fights their responsive rules (notably the globals.css rule
 * that hides .appnav-links below 720px, which would otherwise leave
 * employers with no nav at all on mobile).
 *
 * The topbar used to be brand-lockup-then-Log-out-button with nothing
 * between them — the sidebar restructure (2026-09) moved navigation out of
 * the header and the header kept its shape without its contents. It now
 * carries the org's own identity (OrgMark + name — this is multi-tenant,
 * so "MyAmbii" alone tells a member nothing about which org they're in)
 * and a persistent "Post a job" (every other surface in the portal depends
 * on a job existing). `org` is optional and null until app/employer/
 * layout.tsx's own /orgs/me fetch resolves — the identity block simply
 * doesn't render until then, same "no flash of wrong data" shape as the
 * `verified` gate below.
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
 *
 * Log out moved from a bare topbar button into the account menu below
 * (2026-10) — see AccountMenu's own doc comment. The sidebar used to carry
 * a second, duplicate Log out button for the narrow width where the
 * topbar's own one had to hide (see git history, .employer-sidebar-logout);
 * that duplicate is gone now that the account menu stays reachable at
 * every width instead of disappearing with the rest of the topbar.
 */
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { isLocalizedPath } from '@/i18n/routing';
import { employerApi } from '@/lib/api';
import { useOrgLogo } from '@/lib/useOrgLogo';
import BrandLockup from './BrandLockup';
import OrgMark from './OrgMark';
import AccountMenu from './AccountMenu';
import NavGlyph, { type NavGlyphName } from './NavGlyphs';

/** `label` is a key under employerShell.nav. */
const SECTIONS: { href: string; label: string; icon: NavGlyphName }[] = [
  { href: '/employer/dashboard', label: 'dashboard', icon: 'dashboard' },
  { href: '/employer/jobs', label: 'jobs', icon: 'postings' },
  { href: '/employer/candidates', label: 'candidates', icon: 'search' },
  { href: '/employer/applicants', label: 'applicants', icon: 'applicants' },
  { href: '/employer/shortlist', label: 'shortlist', icon: 'shortlist' },
  { href: '/employer/billing', label: 'billing', icon: 'billing' },
  { href: '/employer/settings', label: 'settings', icon: 'settings' },
];

/** Staffing companies (Organization.type STAFFING) — see StaffingModule on the API side. */
const STAFFING_SECTIONS: { href: string; label: string; icon: NavGlyphName }[] = [
  { href: '/employer/talent', label: 'talent', icon: 'search' },
  { href: '/employer/requests', label: 'requests', icon: 'applicants' },
  { href: '/employer/submissions', label: 'submissions', icon: 'shortlist' },
  { href: '/employer/clients', label: 'clients', icon: 'postings' },
  // Billing returns with recruiter subscription plans (Phase 2b); the current
  // billing page is employers' assessment-charge documents only.
  { href: '/employer/settings', label: 'settings', icon: 'settings' },
];

/** Minimal shape this shell needs for the topbar identity — a subset of app/employer/layout.tsx's own OrgMeOrganization. */
export interface EmployerOrgIdentity {
  name: string;
  hasLogo: boolean;
}

interface Props {
  verified: boolean;
  /** STAFFING orgs get STAFFING_SECTIONS and no "Post a job". */
  orgType?: 'EMPLOYER' | 'STAFFING';
  org: EmployerOrgIdentity | null;
  onLoggedOut: () => void;
  children: React.ReactNode;
}

export default function EmployerSidebarShell({ verified, org, orgType = 'EMPLOYER', onLoggedOut, children }: Props) {
  const t = useTranslations('employerShell');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menu = orgType === 'STAFFING' ? STAFFING_SECTIONS : SECTIONS;
  const verifiedSections = verified ? menu : menu.filter((s) => s.href === '/employer/settings');
  // Under Arabic, a link to an untranslated page would drop the visitor into
  // English mid-session (middleware sends /ar/<untranslated> to English).
  // Show only the sections that have an Arabic version; Help opens an
  // English-only guide, so it is hidden under Arabic too. Both go away as
  // each screen is translated (see messages/ar.notes.md).
  const sections = locale === 'ar' ? verifiedSections.filter((s) => isLocalizedPath(s.href)) : verifiedSections;
  const showHelp = locale !== 'ar';
  const homeHref = orgType === 'STAFFING' ? '/employer/talent' : '/employer/dashboard';
  const logoUrl = useOrgLogo(org?.hasLogo ?? false);

  async function handleLogout() {
    await employerApi.logout();
    onLoggedOut();
    router.replace('/employer');
  }

  return (
    <div className="employer-shell" data-theme="light">
      <header className="employer-topbar">
        <div className="employer-topbar-brand">
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
          <BrandLockup variant="nav" href={homeHref} />
          {org && (
            <>
              <span className="employer-topbar-divider" aria-hidden="true" />
              {/* Multi-tenant seats mean "MyAmbii" alone doesn't say which org
                  a member is in — this shares the brand band rather than
                  owning it (see this file's own doc comment). */}
              <Link href={homeHref} className="employer-org-identity">
                <OrgMark name={org.name} logoUrl={logoUrl} size={28} />
                <span className="employer-org-name">{org.name}</span>
              </Link>
            </>
          )}
        </div>
        <div className="employer-topbar-actions">
          {/* Reachable from every screen, not just Job Postings — every other
              surface in the portal depends on a job existing. ?new=1 is read
              by EmployerJobs on mount (see that file's own comment) the same
              way the dashboard's existing ?openApplicants deep link works. */}
          {orgType !== 'STAFFING' && (
            <Link href="/employer/jobs?new=1" className="btn btn-primary employer-post-job">
              <span aria-hidden="true">+</span>
              <span className="employer-post-job-label">{t('postJob')}</span>
            </Link>
          )}
          <AccountMenu
            label={org?.name ?? t('account')}
            items={[
              { label: t('nav.settings'), href: '/employer/settings', icon: 'settings' },
              { label: t('nav.billing'), href: '/employer/billing', icon: 'billing' },
              { label: t('teamMembers'), href: '/employer/settings#team', icon: 'applicants' },
              { label: t('logout'), onClick: handleLogout, icon: 'logout' },
            ]}
          />
        </div>
      </header>
      <div className="employer-body">
        <nav className={mobileOpen ? 'employer-sidebar is-open' : 'employer-sidebar'}>
          {sections.map((s) => {
            const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={active ? 'side-glass active' : 'side-glass'}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMobileOpen(false)}
              >
                <span className="nav-glass-tile">
                  <NavGlyph name={s.icon} />
                </span>
                <span>{t(`nav.${s.label}`)}</span>
              </Link>
            );
          })}
          {/* Ungated — see this file's own doc comment on why Help sits
              outside the `verified` filter above. Opens in its own named
              tab (never this one) — see HelpGuidePage.tsx's own doc comment
              on why the help pages carry no way back into the app. */}
          {showHelp && (
          <Link
            href={orgType === 'STAFFING' ? '/help/recruiter' : '/help/employer'}
            target="myambii-help"
            rel="noopener"
            className="side-glass"
            onClick={() => setMobileOpen(false)}
          >
            <span className="nav-glass-tile">
              <NavGlyph name="help" />
            </span>
            <span>{t('help')}</span>
          </Link>
          )}
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
