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
 * ("— Free until 30 November 2026" on the bar) — see globals.css's own
 * `.beta-promo-scroll .beta-promo-date` comment: this component's date
 * always renders on its own line (a deterministic break, not a
 * width-triggered wrap), and an em dash is an inline joiner that reads as
 * orphaned punctuation sitting alone at the start of a line. The bar keeps
 * the dash because it never breaks — it's one component, one line, one
 * source fact, but two different punctuation needs depending on whether a
 * line break sits between "jobs" and "Free".
 *
 * The shape (a central panel plus two rolled ends) is pure CSS — see
 * `.beta-promo-scroll` in globals.css for why: a bitmap or fixed-viewBox
 * SVG would either clip or letterbox once the panel stopped sizing to its
 * own content (see that rule's own comment on the fixed ~420px width and
 * why the lead clause wraps inside it rather than growing the box).
 *
 * `role="note"`, not a link or button, not dismissible — same as
 * BetaPromoBar. Unlike the bar, the lead clause here is NOT one uniform
 * weight: "Candidates:" is wrapped in a `<strong>` so it can carry its own
 * font-weight (700, set explicitly in globals.css — never the UA default
 * bold, same discipline as everything else in that file) against the rest
 * of the clause at 600. That only exists on the ribbon, scoped to
 * `.beta-promo-scroll strong` — BetaPromoBar's plain-text span is
 * deliberately untouched, see that rule's own comment for why a shared,
 * unscoped selector on this pair of components is exactly the mistake to
 * avoid here.
 *
 * The date's own spaces are replaced with U+00A0 (non-breaking space)
 * before rendering — NOT for the "Free until" lead-in, only for
 * formatBetaPromoDate's output. At the ribbon's enlarged/bolded date size
 * (see that CSS rule's own comment), the full date line no longer always
 * fits the box on narrow viewports, and when it has to wrap, an ordinary
 * space would let the browser break it anywhere — including between "30"
 * and "November", or "November" and "2026", which reads as broken rather
 * than deliberate. Non-breaking spaces inside the date string remove
 * every wrap point except the one between "until" and the date itself, so
 * if this line does wrap, it always wraps as "Free until" / "30 November
 * 2026" — the date stays a single intact unit — never mid-date. The bar's
 * own date (BetaPromoBar.tsx) doesn't need this: `.beta-promo-bar
 * .beta-promo-date` is `white-space: nowrap`, so it can never wrap at any
 * width in the first place.
 */
import { useBetaPromoVisible } from '@/lib/useBetaPromoVisible';
import { BETA_FREE_UNTIL, formatBetaPromoDate } from '@/lib/betaPromo';

export default function BetaPromoScroll() {
  const visible = useBetaPromoVisible();

  if (!visible) return null;

  return (
    <div className="beta-promo-scroll" role="note">
      <span><strong>Candidates:</strong> Be among the first to prove your AI skills and apply for jobs</span>{' '}
      <span className="beta-promo-date">Free until {formatBetaPromoDate(BETA_FREE_UNTIL).replace(/ /g, ' ')}</span>
    </div>
  );
}
