/** One city result from a location search — enough to populate every
 * structured location field on CandidateProfile in a single selection,
 * with no second round trip needed before saving. */
export interface LocationSuggestion {
  placeId: string;
  city: string;
  region: string | null;
  /** ISO 3166-1 alpha-2, e.g. "US", "IN" — never a display name. */
  country: string;
  lat: number | null;
  lng: number | null;
}

/** Swappable so Google Places can be replaced (or mocked in tests) without
 * touching LocationSearchService — same pattern as EmailProvider. */
export interface LocationSearchProvider {
  search(query: string): Promise<LocationSuggestion[]>;
}

export const LOCATION_SEARCH_PROVIDER = Symbol('LOCATION_SEARCH_PROVIDER');
