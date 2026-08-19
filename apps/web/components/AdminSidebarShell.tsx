'use client';

/**
 * Platform admin console shell: slim topbar (brand + Log out) and a left
 * sidebar for section navigation, mirroring EmployerSidebarShell's pattern
 * exactly (same off-canvas-drawer behavior below 860px, same structure) —
 * see that component's own comment for why this doesn't just reuse
 * .appnav* or the employer shell's own classes directly.
 *
 * The nav list is the full target console hierarchy, not just what's
 * built today: sections with a real backing admin endpoint are live
 * links; everything else renders as a disabled "Soon" entry rather than
 * being omitted outright, so the console's intended shape stays visible
 * rather than looking finished at 3 sections out of 15. See the
 * feat/admin-console-shell audit for exactly what each live section is
 * backed by and why the rest have nothing to administer yet.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logout } from '@/lib/api';
import BrandLockup from './BrandLockup';

type NavLeaf =
  | { kind: 'link'; href: string; label: string }
  | { kind: 'disabled'; label: string };

interface NavGroup {
  label: string;
  items: NavLeaf[];
}

const TOP_LINK = { href: '/admin/dashboard', label: 'Dashboard' };

const GROUPS: NavGroup[] = [
  {
    label: 'Assessment Management',
    items: [
      { kind: 'link', href: '/admin/assessments', label: 'Assessment Config' },
      { kind: 'link', href: '/admin/review', label: 'Session Reviews' },
      { kind: 'link', href: '/admin/attempts', label: 'Attempt Reviews' },
      { kind: 'link', href: '/admin/interview-questions', label: 'Interview Questions' },
    ],
  },
  {
    label: 'Compliance Center',
    items: [
      { kind: 'link', href: '/admin/compliance', label: 'Privacy Requests' },
      { kind: 'link', href: '/admin/compliance/exports', label: 'Data Exports' },
    ],
  },
  {
    label: 'Billing',
    items: [{ kind: 'link', href: '/admin/billing', label: 'Billing Profiles' }],
  },
  {
    label: 'Roadmap',
    items: [
      { kind: 'disabled', label: 'User Management' },
      { kind: 'disabled', label: 'Organization Management' },
      { kind: 'disabled', label: 'Candidate Management' },
      { kind: 'disabled', label: 'Recruitment Management' },
      { kind: 'disabled', label: 'AI Governance' },
      { kind: 'disabled', label: 'Security Center' },
      { kind: 'disabled', label: 'Monitoring & Operations' },
      { kind: 'disabled', label: 'Data Management' },
      { kind: 'disabled', label: 'Notifications' },
      { kind: 'disabled', label: 'Integrations' },
      { kind: 'disabled', label: 'Analytics' },
      { kind: 'disabled', label: 'System Configuration' },
    ],
  },
];

const EXPANDED_GROUPS_KEY = 'admin-sidebar-expanded-groups';

const ALL_HREFS: string[] = [
  TOP_LINK.href,
  ...GROUPS.flatMap((g) => g.items.filter((i): i is Extract<NavLeaf, { kind: 'link' }> => i.kind === 'link').map((i) => i.href)),
];

/**
 * Longest-prefix-match, not "does this one href match" — two nav hrefs can
 * legitimately be prefixes of each other (e.g. /admin/compliance and
 * /admin/compliance/exports), and a plain per-link startsWith check would
 * light up both simultaneously while viewing the more specific page. Only
 * the single best (longest) matching href across the whole nav is ever
 * "active".
 */
function bestMatchHref(pathname: string): string | null {
  const matches = ALL_HREFS.filter((href) => pathname === href || pathname.startsWith(`${href}/`));
  if (matches.length === 0) return null;
  return matches.reduce((best, h) => (h.length > best.length ? h : best));
}

function isLinkActive(href: string, pathname: string) {
  return href === bestMatchHref(pathname);
}

function isGroupActive(group: NavGroup, pathname: string) {
  return group.items.some((item) => item.kind === 'link' && isLinkActive(item.href, pathname));
}

function defaultExpanded(pathname: string): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const group of GROUPS) state[group.label] = isGroupActive(group, pathname);
  return state;
}

function readStoredExpanded(): Record<string, boolean> | null {
  try {
    const raw = window.sessionStorage.getItem(EXPANDED_GROUPS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistExpanded(state: Record<string, boolean>) {
  try {
    window.sessionStorage.setItem(EXPANDED_GROUPS_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (private browsing, etc.) — state just won't persist
  }
}

function ChevronIcon() {
  return (
    <svg
      className="admin-sidebar-group-chevron"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

interface Props {
  onLoggedOut: () => void;
  children: React.ReactNode;
}

export default function AdminSidebarShell({ onLoggedOut, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => defaultExpanded(pathname));
  const hydratedRef = useRef(false);

  // sessionStorage isn't available during SSR, so the very first render always
  // uses defaultExpanded(pathname); this effect layers in whatever the admin
  // had persisted from earlier in the session, then (every time, including on
  // route changes within this already-mounted shell) force-opens whichever
  // group holds the now-active page so the admin never loses their place —
  // without touching any other group the admin has manually toggled.
  useEffect(() => {
    setExpanded((prev) => {
      const base = hydratedRef.current ? prev : { ...prev, ...(readStoredExpanded() ?? {}) };
      hydratedRef.current = true;
      const next = { ...base };
      let changed = base !== prev;
      for (const group of GROUPS) {
        if (isGroupActive(group, pathname) && !next[group.label]) {
          next[group.label] = true;
          changed = true;
        }
      }
      if (changed) persistExpanded(next);
      return changed ? next : prev;
    });
  }, [pathname]);

  function toggleGroup(label: string) {
    setExpanded((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      persistExpanded(next);
      return next;
    });
  }

  async function handleLogout() {
    await logout();
    onLoggedOut();
    router.replace('/candidate');
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <button
          type="button"
          className="admin-nav-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <BrandLockup variant="nav" href="/admin/dashboard" suffix="Admin" />
        <button type="button" className="appnav-logout" onClick={handleLogout}>Log out</button>
      </header>
      <div className="admin-body">
        <nav className={mobileOpen ? 'admin-sidebar is-open' : 'admin-sidebar'}>
          <Link
            href={TOP_LINK.href}
            className={isLinkActive(TOP_LINK.href, pathname) ? 'active' : ''}
            onClick={() => setMobileOpen(false)}
          >
            {TOP_LINK.label}
          </Link>
          {GROUPS.map((group) => {
            const isOpen = expanded[group.label] ?? false;
            const itemsId = `admin-sidebar-group-${group.label.replace(/\s+/g, '-').toLowerCase()}`;
            return (
              <div key={group.label} className="admin-sidebar-group">
                <button
                  type="button"
                  className={isOpen ? 'admin-sidebar-group-header' : 'admin-sidebar-group-header is-collapsed'}
                  aria-expanded={isOpen}
                  aria-controls={itemsId}
                  onClick={() => toggleGroup(group.label)}
                >
                  <span className="admin-sidebar-section-label">{group.label}</span>
                  <span className="admin-sidebar-group-meta">
                    {!isOpen && <span className="admin-sidebar-group-count">{group.items.length}</span>}
                    <ChevronIcon />
                  </span>
                </button>
                <div
                  id={itemsId}
                  className={isOpen ? 'admin-sidebar-group-items' : 'admin-sidebar-group-items is-collapsed'}
                >
                  {group.items.map((item) =>
                    item.kind === 'disabled' ? (
                      <span key={item.label} className="admin-sidebar-disabled">
                        {item.label}
                        <span className="admin-sidebar-disabled-tag">Soon</span>
                      </span>
                    ) : (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={isLinkActive(item.href, pathname) ? 'active' : ''}
                        onClick={() => setMobileOpen(false)}
                      >
                        {item.label}
                      </Link>
                    ),
                  )}
                </div>
              </div>
            );
          })}
          {/* Duplicate of the topbar's own Log out button — CSS shows exactly
              one of the two at any width (see .admin-sidebar-logout). */}
          <button type="button" className="admin-sidebar-logout" onClick={handleLogout}>
            Log out
          </button>
        </nav>
        {mobileOpen && (
          <div
            className="admin-sidebar-scrim"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
