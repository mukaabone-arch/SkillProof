'use client';

/** Persistent nav for the PLATFORM_ADMIN console — parallel to CandidateNav, scoped to admin-only pages. */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout } from '@/lib/api';
import BrandLockup from './BrandLockup';

const LINKS = [
  { href: '/admin/assessments', label: 'Assessments' },
  { href: '/admin/review', label: 'Session Reviews' },
  { href: '/admin/compliance', label: 'Compliance Center' },
];

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
    router.replace('/candidate');
  }

  return (
    <div className="appnav">
      <div className="appnav-inner">
        <BrandLockup variant="nav" href="/admin/assessments" suffix="Admin" />
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
