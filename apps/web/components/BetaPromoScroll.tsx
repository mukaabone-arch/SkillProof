'use client';

/**
 * Floating scroll/ribbon acquisition banner for the two pages where the
 * thin bar used to render above the chrome: the landing page ("/") and the
 * candidate login screen ("/candidate"). Same fact as BetaPromoBar, same
 * source (BETA_FREE_UNTIL via formatBetaPromoDate) and same logged-out/
 * offer-window gating — see useBetaPromoVisible for why that rule lives in
 * one place rather than being copied into both components.
 *
 * Unlike BetaPromoBar, this component owns no path allow-list: it's mounted
 * directly inline by the two pages that want it (app/page.tsx's hero,
 * OtpLogin.tsx's split panel), so there's nothing to gate on besides "is
 * the offer live and the visitor logged out" — the hook already answers
 * that. It also takes no placement prop; each mount site owns its own CSS
 * for where this sits (`.lp-hero-inner > .beta-promo-scroll`,
 * `.auth-split-panel > .beta-promo-scroll` in globals.css) rather than this
 * component knowing anything about either page's layout.
 *
 * The date line deliberately drops the thin bar's leading em dash
 * ("— until 30 November" on the bar) — see globals.css's own
 * `.beta-promo-scroll .beta-promo-date` comment: this component's date
 * always renders on its own line (a deterministic break, not a
 * width-triggered wrap), and an em dash is an inline joiner that reads as
 * orphaned punctuation sitting alone at the start of a line. The bar keeps
 * the dash because it never breaks — it's one component, one line, one
 * source fact, but two different punctuation needs depending on whether a
 * line break sits between "beta" and "until".
 *
 * The shape (a central panel plus two rolled ends) is pure CSS — see
 * `.beta-promo-scroll` in globals.css for why: a bitmap or fixed-viewBox
 * SVG would either clip or letterbox depending on how long the date string
 * is. A box that sizes to its own content doesn't have that problem.
 *
 * `role="note"`, not a link or button, not dismissible — same as
 * BetaPromoBar. The emphasis on "Candidates:" is weight applied by class
 * (the whole string shares one font-weight), not a `<strong>` picked for
 * its own default styling.
 */
import { useBetaPromoVisible } from '@/lib/useBetaPromoVisible';
import { BETA_FREE_UNTIL, formatBetaPromoDate } from '@/lib/betaPromo';

export default function BetaPromoScroll() {
  const visible = useBetaPromoVisible();

  if (!visible) return null;

  return (
    <div className="beta-promo-scroll" role="note">
      <span>Candidates: free while we&apos;re in beta</span>{' '}
      <span className="beta-promo-date">until {formatBetaPromoDate(BETA_FREE_UNTIL)}</span>
    </div>
  );
}
