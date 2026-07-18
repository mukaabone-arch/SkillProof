'use client';

/** Employer portal header — same treatment as CandidateNav, now with real nav links (Home, Shortlist) as the portal grows past one page. */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import Logo from './Logo';

const { logout } = employerApi;

const LINKS = [
  { href: '/employer', label: 'Home' },
  { href: '/employer/dashboard', label: 'Dashboard' },
  { href: '/employer/shortlist', label: 'Shortlist' },
];

interface Props {
  onLoggedOut: () => void;
}

export default function EmployerNav({ onLoggedOut }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  // See CandidateNav's handleLogout: explicit navigation, not just the
  // page-local onLoggedOut callback, so logout reliably lands on the
  // employer login screen regardless of which employer page it's fired from.
  async function handleLogout() {
    await employerApi.logout();
    onLoggedOut();
    router.replace('/employer');
  }

  return (
    <div className="appnav">
      <div className="appnav-inner">
        <Link href="/employer" className="appnav-logo">
          <Logo className="brand-logo" />
          <span className="brand-product-name">SkillProof</span>
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
