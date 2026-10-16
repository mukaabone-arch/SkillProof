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
 * step in AssessCandidateAction. /faq and /help/* keep a mixed audience —
 * the qualifier is still what keeps an employer reader from misreading a
 * candidate-only offer as theirs — but it's incidental there, not the
 * page's headline, which is why it's a thin bar and not a pitch.
 *
 * /employer is deliberately NOT in the allow-list below (it used to be):
 * that page's whole job is convincing employers to sign up, and there's
 * no employer-side free offer to qualify this message into one — only a
 * candidate-side fact that doesn't belong on a page written for the other
 * audience. Not replaced with an employer-facing banner either: there's
 * no employer offer to make, and a value statement here would just
 * compete with the page's own headline for the same attention.
 *
 * Mounted once, app-wide, in Providers.tsx (ahead of `children` in DOM
 * order, outside CandidateVerificationProvider so its own blocking
 * redirect placeholder never hides this) — the same shape as the
 * always-mounted AnalyticsGate/LimitReachedModal, so it can't end up
 * reachable from only one page the way the footer did (see app/page.tsx's
 * own history). The landing page ("/") and the candidate login screen
 * ("/candidate") are NOT in this component's allow-list below: both render
 * BetaPromoScroll in-page instead (the landing page's hero, OtpLogin.tsx's
 * split panel) rather than this bar.
 */
import { usePathname } from 'next/navigation';
import { useBetaPromoVisible } from '@/lib/useBetaPromoVisible';
import { BETA_FREE_UNTIL, formatBetaPromoDate } from '@/lib/betaPromo';

const ALLOWED_EXACT_PATHS = new Set(['/faq']);
const ALLOWED_PATH_PREFIXES = ['/help'];

function isAllowedPath(pathname: string): boolean {
  if (ALLOWED_EXACT_PATHS.has(pathname)) return true;
  return ALLOWED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function BetaPromoBar() {
  const pathname = usePathname() ?? '';
  const visible = useBetaPromoVisible();

  if (!visible) return null;
  if (!isAllowedPath(pathname)) return null;

  return (
    <div className="beta-promo-bar" role="note">
      <span>Candidates: Be among the first to prove your AI skills and apply for jobs</span>{' '}
      <span className="beta-promo-date">— Free until {formatBetaPromoDate(BETA_FREE_UNTIL)}</span>
    </div>
  );
}
