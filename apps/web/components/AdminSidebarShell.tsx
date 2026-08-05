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
import { useState } from 'react';
import { logout } from '@/lib/api';
import Logo from './Logo';

type NavItem =
  | { kind: 'section'; label: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'disabled'; label: string };

const NAV: NavItem[] = [
  { kind: 'link', href: '/admin/dashboard', label: 'Dashboard' },

  { kind: 'section', label: 'Assessment Management' },
  { kind: 'link', href: '/admin/assessments', label: 'Assessment Config' },
  { kind: 'link', href: '/admin/review', label: 'Session Reviews' },
  { kind: 'link', href: '/admin/attempts', label: 'Attempt Reviews' },
  { kind: 'link', href: '/admin/interview-questions', label: 'Interview Questions' },

  { kind: 'section', label: 'Compliance Center' },
  { kind: 'link', href: '/admin/compliance', label: 'Privacy Requests' },

  { kind: 'section', label: 'Roadmap' },
  { kind: 'disabled', label: 'User Management' },
  { kind: 'disabled', label: 'Organization Management' },
  { kind: 'disabled', label: 'Candidate Management' },
  { kind: 'disabled', label: 'Recruitment Management' },
  { kind: 'disabled', label: 'AI Governance' },
  { kind: 'disabled', label: 'Security Center' },
  { kind: 'disabled', label: 'Monitoring & Operations' },
  { kind: 'disabled', label: 'Data Management' },
  { kind: 'disabled', label: 'Notifications' },
  { kind: 'disabled', label: 'Billing' },
  { kind: 'disabled', label: 'Integrations' },
  { kind: 'disabled', label: 'Analytics' },
  { kind: 'disabled', label: 'System Configuration' },
];

interface Props {
  onLoggedOut: () => void;
  children: React.ReactNode;
}

export default function AdminSidebarShell({ onLoggedOut, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    await logout();
    onLoggedOut();
    router.replace('/');
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
        <Link href="/admin/dashboard" className="appnav-logo">
          <Logo className="brand-logo" />
          <span className="brand-product-name">
            SkillProof <span style={{ color: 'var(--ink-60)', fontWeight: 500 }}>Admin</span>
          </span>
        </Link>
        <button type="button" className="appnav-logout" onClick={handleLogout}>Log out</button>
      </header>
      <div className="admin-body">
        <nav className={mobileOpen ? 'admin-sidebar is-open' : 'admin-sidebar'}>
          {NAV.map((item, i) => {
            if (item.kind === 'section') {
              return (
                <div key={`section-${i}`} className="admin-sidebar-section-label">
                  {item.label}
                </div>
              );
            }
            if (item.kind === 'disabled') {
              return (
                <span key={item.label} className="admin-sidebar-disabled">
                  {item.label}
                  <span className="admin-sidebar-disabled-tag">Soon</span>
                </span>
              );
            }
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'active' : ''}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
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
