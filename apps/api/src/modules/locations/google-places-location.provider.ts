import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { LocationSearchProvider, LocationSuggestion } from './location-search-provider.interface';

/** At most this many suggestions per query — bounds both the Autocomplete
 * result set and (more importantly, cost-wise) the number of Place Details
 * calls issued to enrich each one below. */
const MAX_SUGGESTIONS = 5;

interface AutocompletePrediction {
  place_id: string;
  structured_formatting?: { main_text?: string };
}
interface AutocompleteResponse {
  status: string;
  predictions?: AutocompletePrediction[];
}

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}
interface DetailsResponse {
  status: string;
  result?: {
    address_components?: AddressComponent[];
    geometry?: { location?: { lat: number; lng: number } };
  };
}

function componentByType(components: AddressComponent[] | undefined, type: string): AddressComponent | undefined {
  return components?.find((c) => c.types.includes(type));
}

/**
 * Google Places Autocomplete (legacy REST API, not the newer Places API
 * (New)) restricted to city-type results via `types=(cities)`. Autocomplete
 * predictions alone never carry geometry or an ISO country code — that's a
 * hard constraint of the API, not a corner cut here — so each prediction is
 * enriched with one Place Details call (fields=address_component,geometry
 * only, to keep it on Places' cheapest "Basic Data" billing SKU) run in
 * parallel, capped to MAX_SUGGESTIONS. This makes every LocationSuggestion
 * immediately persistable (lat/lng/ISO2 country included) with no second
 * round trip needed when the candidate picks one — LocationSearchService's
 * query-level cache is what keeps the resulting per-keystroke cost down for
 * repeated prefixes, not fewer Details calls per uncached query.
 */
@Injectable()
export class GooglePlacesLocationProvider implements LocationSearchProvider {
  private readonly logger = new Logger(GooglePlacesLocationProvider.name);

  async search(query: string): Promise<LocationSuggestion[]> {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Location search is not configured.');
    }

    const autocompleteUrl = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json');
    autocompleteUrl.searchParams.set('input', query);
    autocompleteUrl.searchParams.set('types', '(cities)');
    autocompleteUrl.searchParams.set('key', apiKey);

    const res = await fetch(autocompleteUrl).catch(() => null);
    if (!res || !res.ok) {
      throw new ServiceUnavailableException('Location search is temporarily unavailable.');
    }
    const body = (await res.json()) as AutocompleteResponse;
    if (body.status === 'ZERO_RESULTS') return [];
    if (body.status !== 'OK') {
      this.logger.warn(`Places Autocomplete returned status ${body.status}`);
      throw new ServiceUnavailableException('Location search is temporarily unavailable.');
    }

    const predictions = (body.predictions ?? []).slice(0, MAX_SUGGESTIONS);
    const enriched = await Promise.allSettled(predictions.map((p) => this.resolveDetails(p, apiKey)));

    return enriched
      .filter((r): r is PromiseFulfilledResult<LocationSuggestion | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is LocationSuggestion => v !== null);
  }

  /** One prediction's Details lookup — returns null (rather than throwing)
   * on any failure, so one bad placeId doesn't drop the whole result set. */
  private async resolveDetails(prediction: AutocompletePrediction, apiKey: string): Promise<LocationSuggestion | null> {
    try {
      const detailsUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
      detailsUrl.searchParams.set('place_id', prediction.place_id);
      detailsUrl.searchParams.set('fields', 'address_component,geometry');
      detailsUrl.searchParams.set('key', apiKey);

      const res = await fetch(detailsUrl);
      if (!res.ok) return null;
      const body = (await res.json()) as DetailsResponse;
      if (body.status !== 'OK' || !body.result) return null;

      const components = body.result.address_components;
      const country = componentByType(components, 'country');
      if (!country) return null; // no country code means this isn't a real, mappable place

      const city = componentByType(components, 'locality')?.long_name ?? prediction.structured_formatting?.main_text;
      if (!city) return null;

      const region = componentByType(components, 'administrative_area_level_1')?.long_name ?? null;
      const location = body.result.geometry?.location;

      return {
        placeId: prediction.place_id,
        city,
        region,
        country: country.short_name,
        lat: location?.lat ?? null,
        lng: location?.lng ?? null,
      };
    } catch {
      return null;
    }
  }
}
