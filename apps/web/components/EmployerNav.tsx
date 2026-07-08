'use client';

/** Employer portal header — same treatment as CandidateNav, keeps the existing minimal employer nav as-is. */
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import Logo from './Logo';

const { logout } = employerApi;

interface Props {
  onLoggedOut: () => void;
}

export default function EmployerNav({ onLoggedOut }: Props) {
  async function handleLogout() {
    await logout();
    onLoggedOut();
  }

  return (
    <div className="appnav">
      <div className="appnav-inner">
        <Link href="/employer" className="appnav-logo">
          <Logo className="brand-logo" />
          <span className="brand-product-name">SkillProof</span>
        </Link>
        <div className="appnav-links">
          <span className="meta" style={{ margin: 0 }}>Employer portal</span>
          <button className="appnav-logout" onClick={handleLogout}>Log out</button>
        </div>
      </div>
    </div>
  );
}
