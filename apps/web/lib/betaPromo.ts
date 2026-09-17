/**
 * Beta pricing ends at the close of 30 November 2026, IST — the audience and
 * the business are both in India, so the cutoff is Asia/Kolkata, not UTC.
 * A UTC cutoff would switch the banner off at 05:30 local on the 30th, most
 * of a day early.
 *
 * Single source of truth: BetaPromoBar renders nothing once `isBetaPromoActive`
 * returns false, and its own copy is generated from this constant too, so
 * the displayed date and the cutoff logic can never drift apart.
 */
export const BETA_FREE_UNTIL = new Date('2026-11-30T23:59:59+05:30');

export function isBetaPromoActive(now: Date = new Date()): boolean {
  return now.getTime() <= BETA_FREE_UNTIL.getTime();
}

/**
 * "30 November" — day + month, no year (matches the banner copy), read in
 * IST regardless of the viewer's own timezone so it never disagrees with
 * the IST cutoff `isBetaPromoActive` enforces.
 */
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Asia/Kolkata',
});

export function formatBetaPromoDate(date: Date): string {
  return dateFormatter.format(date);
}
