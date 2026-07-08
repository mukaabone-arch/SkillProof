'use client';

/** Persistent nav across the four main candidate areas — always accessible, clear active-state. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/lib/api';
import Logo from './Logo';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
  { href: '/assessments', label: 'Assessments' },
  { href: '/jobs', label: 'Jobs' },
];

interface Props {
  onLoggedOut: () => void;
}

export default function CandidateNav({ onLoggedOut }: Props) {
  const pathname = usePathname();

  async function handleLogout() {
    await logout();
    onLoggedOut();
  }

  return (
    <div className="appnav">
      <div className="appnav-inner">
        <Link href="/" className="appnav-logo">
          <Logo className="brand-logo" />
          <span className="brand-product-name">SkillProof</span>
        </Link>
        <div className="appnav-links">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={pathname === l.href ? 'active' : ''}
            >
              {l.label}
            </Link>
          ))}
          <button className="appnav-logout" onClick={handleLogout}>Log out</button>
        </div>
      </div>
    </div>
  );
}
