'use client';

/** Persistent nav across the four main candidate areas — always accessible, clear active-state. */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout } from '@/lib/api';
import Logo from './Logo';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/profile', label: 'Profile' },
  { href: '/assessments', label: 'Assessments' },
  { href: '/jobs', label: 'Jobs' },
];

interface Props {
  /** Optional: pages guarded by useRequireAuth don't need local teardown — the redirect below already handles it. */
  onLoggedOut?: () => void;
}

export default function CandidateNav({ onLoggedOut }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  // Some pages that render this nav (e.g. /resume) still track their own
  // "loggedIn" state, and live on a route other than the login page itself —
  // flipping that local state alone just strands the user on the same page
  // with the nav gone. Navigate explicitly so logout always lands on the
  // login screen, from any tab, on any route. Tokens must be cleared
  // (awaited) before navigating so the destination page's own getToken()
  // check sees the logged-out state on first render.
  async function handleLogout() {
    await logout();
    onLoggedOut?.();
    router.replace('/');
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
