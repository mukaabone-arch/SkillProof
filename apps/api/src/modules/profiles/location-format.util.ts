/** The subset of CandidateProfile fields needed to render a display string. */
export interface LocationDisplayFields {
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  locationLegacy: string | null;
}

/**
 * Structured-preferred display string for a candidate's location, used
 * everywhere a location is shown to someone other than the candidate
 * themself (employer-facing candidate/application/shortlist views, match
 * results, resume PDFs) — never the raw column names, so every one of
 * those call sites stays correct automatically as candidates re-select
 * from the new city dropdown. Falls back to the pre-migration free-text
 * value (locationLegacy) until that happens; see CandidateProfile's own
 * doc comment on locationLegacy for why that value is never dropped.
 */
export function formatCandidateLocation(p: LocationDisplayFields): string | null {
  if (p.locationCity) {
    return [p.locationCity, p.locationRegion, p.locationCountry].filter(Boolean).join(', ');
  }
  return p.locationLegacy;
}
