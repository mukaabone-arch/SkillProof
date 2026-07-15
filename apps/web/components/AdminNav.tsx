'use client';

/** Persistent nav for the PLATFORM_ADMIN console — parallel to CandidateNav/EmployerNav, scoped to admin-only pages. */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout } from '@/lib/api';
import Logo from './Logo';

const LINKS = [{ href: '/admin/assessments', label: 'Assessments' }];

interface Props {
  onLoggedOut: () => void;
}

export default function AdminNav({ onLoggedOut }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  // See CandidateNav's handleLogout: navigate explicitly rather than relying
  // on the caller's onLoggedOut to redirect — admins share the candidate OTP
  // login at '/'.
  async function handleLogout() {
    await logout();
    onLoggedOut();
    router.replace('/');
  }

  return (
    <div className="appnav">
      <div className="appnav-inner">
        <Link href="/admin/assessments" className="appnav-logo">
          <Logo className="brand-logo" />
          <span className="brand-product-name">
            SkillProof <span style={{ color: 'var(--ink-60)', fontWeight: 500 }}>Admin</span>
          </span>
        </Link>
        <div className="appnav-links">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>
              {l.label}
            </Link>
          ))}
          <button className="appnav-logout" onClick={handleLogout}>Log out</button>
        </div>
      </div>
    </div>
  );
}
