'use client';

/**
 * Header for standalone pages that anyone with the link can land on — a
 * candidate, an employer, or a logged-out third party (e.g. a recruiter
 * following a certificate URL shared on LinkedIn). Unlike CandidateNav/
 * EmployerNav this never assumes a session exists; it always offers the way
 * back to the public home page, and additionally offers "Back to dashboard"
 * only when a session for one of the two separately-scoped portals (see
 * lib/api.ts) is actually present in this browser.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getToken, employerApi } from '@/lib/api';
import Logo from './Logo';

export default function PublicNav() {
  const [dashboardHref, setDashboardHref] = useState<string | null>(null);

  useEffect(() => {
    // Candidate/admin and employer tokens live under separate storage keys
    // and are independent of who this particular page happens to be about —
    // check both, since either, both, or neither may be logged in here.
    if (employerApi.getToken()) {
      setDashboardHref('/employer');
    } else if (getToken()) {
      // "/" resolves to the right dashboard for both roles that share this
      // token scope — the candidate dashboard, or the admin console if the
      // account is PLATFORM_ADMIN (see app/page.tsx's role check).
      setDashboardHref('/');
    }
  }, []);

  return (
    <div className="appnav">
      <div className="appnav-inner">
        <Link href="/" className="appnav-logo">
          <Logo className="brand-logo" />
          <span className="brand-product-name">SkillProof</span>
        </Link>
        {dashboardHref && (
          <div className="appnav-links">
            <Link href={dashboardHref}>← Back to dashboard</Link>
          </div>
        )}
      </div>
    </div>
  );
}
