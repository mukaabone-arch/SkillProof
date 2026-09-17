'use client';

/**
 * Thin acquisition banner above the site chrome — never inside it. The
 * original ask was to centre this in the header, but the header is a
 * three-part layout (BrandLockup left, nav right) with its own history:
 * hand-rolled twice, unified into BrandLockup, then clipped by the
 * header's fixed height. A promo competing for that same row reopens all
 * of it. A bar above the header has its own line and background, reads as
 * a promotion rather than navigation, and can be removed later without
 * touching header layout at all.
 *
 * Logged-out acquisition message only — never shown once a candidate or
 * employer token is present. Restricted to the public marketing surface
 * (landing, the two portal entry/login screens, FAQ, Help); explicitly
 * excluded from every authenticated portal route and the assessment-taking
 * flow, where a candidate's tab switches and answer timing are recorded as
 * integrity signals and a promo banner has no business being in frame.
 *
 * "Candidates:" is load-bearing, not decoration — the free offer is
 * candidate-side only. Employer-triggered assessment requests are charged
 * from day one (₹0/₹177/₹590 by candidate depth), disclosed at the confirm
 * step in AssessCandidateAction. An unqualified "Free while we're in beta"
 * over /employer — the page whose whole job is convincing employers to sign
 * up — would tell them something untrue about what they're about to pay.
 *
 * Mounted once, app-wide, in Providers.tsx (ahead of `children` in DOM
 * order, outside CandidateVerificationProvider so its own blocking
 * redirect placeholder never hides this) — the same shape as the
 * always-mounted AnalyticsGate/LimitReachedModal, so it can't end up
 * reachable from only one page the way the footer did (see app/page.tsx's
 * own history). The one exception is the landing page: `.lp-header` there
 * is `position: fixed`, so this component renders again explicitly in
 * app/page.tsx (via the `stacked` prop) wrapped together with
 * LandingHeader in `.lp-header-stack` — see that class in globals.css for
 * why (a guessed pixel offset for `.lp-header`'s `top` would drift the
 * moment this bar's text wraps to a second line at a narrow width; sharing
 * one fixed flow container sidesteps that instead of measuring it).
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getToken, employerApi } from '@/lib/api';
import { BETA_FREE_UNTIL, formatBetaPromoDate, isBetaPromoActive } from '@/lib/betaPromo';

interface Props {
  /** Set only by app/page.tsx, where this is wrapped together with LandingHeader inside .lp-header-stack — see this file's own doc comment. */
  stacked?: boolean;
}

const ALLOWED_EXACT_PATHS = new Set(['/', '/candidate', '/employer', '/faq']);
const ALLOWED_PATH_PREFIXES = ['/help'];

function isAllowedPath(pathname: string): boolean {
  if (ALLOWED_EXACT_PATHS.has(pathname)) return true;
  return ALLOWED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function BetaPromoBar({ stacked = false }: Props) {
  const pathname = usePathname() ?? '';
  // Deferred to an effect, same shape as PublicNav's own dashboardHref
  // check — the server never has localStorage, so reading a token during
  // the render that produces the server HTML (or the first client render
  // that has to match it) would disagree with what mounts a moment later
  // and trip a hydration mismatch. First paint always renders as
  // logged-out; this corrects it immediately after mount.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(getToken()) || Boolean(employerApi.getToken()));
  }, [pathname]);

  // The landing page renders its own stacked copy (see this file's own
  // doc comment) — skip the generic app-wide mount there to avoid
  // rendering the bar twice.
  if (pathname === '/' && !stacked) return null;

  if (!isBetaPromoActive()) return null;
  if (!isAllowedPath(pathname)) return null;
  // Acquisition message for logged-out visitors only — never for someone
  // already inside a portal, whatever route they're on when a session
  // happens to exist (e.g. a signed-in candidate revisiting "/").
 if (signedIn !== false) return null;

  return (
    <div className="beta-promo-bar" role="note">
      Candidates: free while we&apos;re in beta — until {formatBetaPromoDate(BETA_FREE_UNTIL)}
    </div>
  );
}
