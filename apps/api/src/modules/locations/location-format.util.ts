/** The subset of location fields needed to render a display string, shared by CandidateProfile and Job. */
export interface LocationDisplayFields {
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  locationLegacy: string | null;
}

/**
 * Structured-preferred display string for a candidate or job's location,
 * used everywhere a location is shown to someone other than its owner
 * (employer-facing candidate/application/shortlist views, match results,
 * resume PDFs, candidate-facing job listings) — never the raw column
 * names, so every one of those call sites stays correct automatically as
 * candidates/employers re-select from the city dropdown. Falls back to
 * the pre-migration free-text value (locationLegacy) until that happens;
 * see CandidateProfile/Job's own doc comment on locationLegacy for why
 * that value is never dropped.
 */
export function formatLocation(p: LocationDisplayFields): string | null {
  if (p.locationCity) {
    return [p.locationCity, p.locationRegion, p.locationCountry].filter(Boolean).join(', ');
  }
  return p.locationLegacy;
}
