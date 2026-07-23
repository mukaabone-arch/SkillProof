import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { LocationSearchProvider, LocationSuggestion } from './location-search-provider.interface';

/** At most this many suggestions per query — bounds both the Autocomplete
 * result set and (more importantly, cost-wise) the number of Place Details
 * calls issued to enrich each one below. */
const MAX_SUGGESTIONS = 5;

interface PlacePrediction {
  placeId: string;
  structuredFormat?: { mainText?: { text?: string } };
}
interface AutocompleteSuggestion {
  placePrediction?: PlacePrediction;
}
interface AutocompleteResponse {
  suggestions?: AutocompleteSuggestion[];
}

interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}
interface DetailsResponse {
  location?: { latitude: number; longitude: number };
  addressComponents?: AddressComponent[];
}

/** Places API (New) reports failures as a non-2xx HTTP status with this
 * body shape — unlike the legacy API's 200-with-a-status-field pattern
 * (REQUEST_DENIED, OVER_QUERY_LIMIT, etc. inside an otherwise-ok response).
 * `error.message` is the whole reason this rewrite exists: the previous
 * provider logged only a bare status and discarded this field, which is
 * what made the legacy API's blanket REQUEST_DENIED (new Cloud projects
 * can't enable it at all — Google now restricts them to this API) so much
 * harder to diagnose than it needed to be. */
interface GoogleApiError {
  error?: { code?: number; message?: string; status?: string };
}

function componentByType(components: AddressComponent[] | undefined, type: string): AddressComponent | undefined {
  return components?.find((c) => c.types.includes(type));
}

/**
 * Google Places API (New) — replaces the legacy Places Autocomplete/Details
 * REST API, which Google now refuses to enable on new Cloud projects
 * (every legacy call came back REQUEST_DENIED). Restricted to city-type
 * results via includedPrimaryTypes: ['locality'] (the New API's equivalent
 * of the legacy `types=(cities)` parameter). Auth moves from a `key` query
 * parameter to an `X-Goog-Api-Key` header, and every call now requires an
 * X-Goog-FieldMask header naming exactly the fields wanted — the New API
 * bills by which fields a Details call's mask includes, so both masks below
 * request only what's actually used downstream (never `*`).
 *
 * Eager enrichment (still here, not moved to a per-selection call): every
 * returned suggestion gets its own parallel Place Details lookup, same as
 * the legacy provider. This was reconsidered — Places (New) bills Details
 * separately from Autocomplete, so enriching suggestions the candidate
 * never picks is a real, avoidable cost — but resolving only the *selected*
 * suggestion would mean search() returns predictions with no lat/lng/ISO2
 * country (the New Autocomplete response carries display text only, see
 * PlacePrediction; geometry and address components are Details-only in
 * both API generations). That needs either a second endpoint the client
 * calls at selection time, or LocationSearchProvider growing a second
 * method — both are a real interface/API-surface change, and the task
 * scoping this rewrite is explicitly apps/api-only with the provider
 * interface held fixed. Lazily resolving would also silently start
 * persisting null lat/lng/country on every new selection until that wiring
 * exists, which is worse than the extra cost. So this stays eager, capped
 * at MAX_SUGGESTIONS, with the narrowest field masks available — the real
 * fix for the "N speculative calls" cost is LocationSearchService's
 * existing query-level cache, which already makes every repeat of a prefix
 * free after the first candidate types it.
 */
@Injectable()
export class GooglePlacesLocationProvider implements LocationSearchProvider {
  private readonly logger = new Logger(GooglePlacesLocationProvider.name);

  async search(query: string): Promise<LocationSuggestion[]> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Location search is not configured.');
    }

    let res: Response;
    try {
      res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          // Only what resolveDetails' fallback city text needs, plus the
          // placeId itself — never the whole message.
          'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
        },
        body: JSON.stringify({
          input: query,
          includedPrimaryTypes: ['locality'],
        }),
      });
    } catch (e) {
      this.logger.warn(`Places Autocomplete (New) request threw: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Location search is temporarily unavailable.');
    }

    const body = (await res.json().catch(() => ({}))) as AutocompleteResponse & GoogleApiError;
    if (!res.ok) {
      this.logger.warn(
        `Places Autocomplete (New) failed: HTTP ${res.status} ${body.error?.status ?? '(no status)'} — ` +
          `${body.error?.message ?? 'Google returned no error message'}`,
      );
      throw new ServiceUnavailableException('Location search is temporarily unavailable.');
    }

    const predictions = (body.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is PlacePrediction => !!p?.placeId)
      .slice(0, MAX_SUGGESTIONS);

    const enriched = await Promise.allSettled(predictions.map((p) => this.resolveDetails(p, apiKey)));

    return enriched
      .filter((r): r is PromiseFulfilledResult<LocationSuggestion | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is LocationSuggestion => v !== null);
  }

  /** One prediction's Details lookup — returns null (rather than throwing)
   * on any failure, so one bad placeId doesn't drop the whole result set. */
  private async resolveDetails(prediction: PlacePrediction, apiKey: string): Promise<LocationSuggestion | null> {
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${prediction.placeId}`, {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'location,addressComponents',
        },
      });
      const body = (await res.json().catch(() => ({}))) as DetailsResponse & GoogleApiError;
      if (!res.ok) {
        this.logger.warn(
          `Places Details (New) failed for ${prediction.placeId}: HTTP ${res.status} ${body.error?.status ?? '(no status)'} — ` +
            `${body.error?.message ?? 'Google returned no error message'}`,
        );
        return null;
      }

      const components = body.addressComponents;
      const country = componentByType(components, 'country');
      if (!country) return null; // no country code means this isn't a real, mappable place

      const city = componentByType(components, 'locality')?.longText ?? prediction.structuredFormat?.mainText?.text;
      if (!city) return null;

      const region = componentByType(components, 'administrative_area_level_1')?.longText ?? null;

      return {
        placeId: prediction.placeId,
        city,
        region,
        country: country.shortText,
        lat: body.location?.latitude ?? null,
        lng: body.location?.longitude ?? null,
      };
    } catch (e) {
      this.logger.warn(`Places Details (New) request threw for ${prediction.placeId}: ${(e as Error).message}`);
      return null;
    }
  }
}
