import type { BadgeVariant } from '@/components/ui';

/**
 * Bands over scoreCandidate's 0-100 output. Deliberately coarse: the
 * underlying score mixes verified and unverified claims, level proximity and
 * a ±5 experience nudge, so the difference between 61 and 66 is not a
 * distinction a candidate should be asked to read anything into.
 *
 * Frontend-only display concern. Unrelated to apps/api's own `scoreBand`
 * (scoring.ts) — that one buckets the same 0-100 number into width-10
 * numeric tiers for employer-side ranking tiebreaks, a different audience
 * and a different purpose. Do not merge these or have one call the other.
 */
export type MatchBand = 'strong' | 'good' | 'partial' | 'none';

export function matchBand(score: number): MatchBand {
  if (score >= 75) return 'strong';
  if (score >= 50) return 'good';
  if (score >= 25) return 'partial';
  return 'none';
}

export const MATCH_BAND_LABELS: Record<MatchBand, string> = {
  strong: 'Strong match',
  good: 'Good match',
  partial: 'Partial match',
  none: 'Not yet a match',
};

/**
 * 'none' maps to 'neutral' (muted gray), never 'danger' (red) — a candidate
 * who hasn't earned badges yet is the most common case, not an alarm.
 */
export const MATCH_BAND_VARIANTS: Record<MatchBand, BadgeVariant> = {
  strong: 'verified',
  good: 'default',
  partial: 'warning',
  none: 'neutral',
};
