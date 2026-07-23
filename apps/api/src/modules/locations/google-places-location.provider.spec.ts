import { ServiceUnavailableException } from '@nestjs/common';
import { GooglePlacesLocationProvider } from './google-places-location.provider';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

const AUTOCOMPLETE_OK = {
  status: 'OK',
  predictions: [
    { place_id: 'place-1', structured_formatting: { main_text: 'Bangalore' } },
    { place_id: 'place-2', structured_formatting: { main_text: 'Bangor' } },
  ],
};

function detailsFor(placeId: string) {
  if (placeId === 'place-1') {
    return {
      status: 'OK',
      result: {
        address_components: [
          { long_name: 'Bangalore', short_name: 'Bangalore', types: ['locality'] },
          { long_name: 'Karnataka', short_name: 'KA', types: ['administrative_area_level_1'] },
          { long_name: 'India', short_name: 'IN', types: ['country'] },
        ],
        geometry: { location: { lat: 12.9716, lng: 77.5946 } },
      },
    };
  }
  // place-2: deliberately malformed (no country component) — must be
  // dropped, not thrown, so one bad prediction never kills the whole batch.
  return { status: 'OK', result: { address_components: [], geometry: undefined } };
}

describe('GooglePlacesLocationProvider', () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.GOOGLE_PLACES_API_KEY = originalKey;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws ServiceUnavailableException when no API key is configured', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    const provider = new GooglePlacesLocationProvider();
    await expect(provider.search('bang')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('parses a valid prediction into a fully structured LocationSuggestion, dropping a malformed one', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    global.fetch = jest.fn((url: string | URL) => {
      const href = url.toString();
      if (href.includes('/autocomplete/')) return Promise.resolve(jsonResponse(AUTOCOMPLETE_OK));
      const placeId = new URL(href).searchParams.get('place_id')!;
      return Promise.resolve(jsonResponse(detailsFor(placeId)));
    }) as unknown as typeof fetch;

    const provider = new GooglePlacesLocationProvider();
    const results = await provider.search('bang');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      placeId: 'place-1',
      city: 'Bangalore',
      region: 'Karnataka',
      country: 'IN',
      lat: 12.9716,
      lng: 77.5946,
    });
  });

  it('ZERO_RESULTS returns an empty array, not an error', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse({ status: 'ZERO_RESULTS' }))) as unknown as typeof fetch;

    const provider = new GooglePlacesLocationProvider();
    await expect(provider.search('zzzzzz')).resolves.toEqual([]);
  });

  it('a non-OK Autocomplete status throws ServiceUnavailableException', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    global.fetch = jest.fn(() =>
      Promise.resolve(jsonResponse({ status: 'OVER_QUERY_LIMIT' })),
    ) as unknown as typeof fetch;

    const provider = new GooglePlacesLocationProvider();
    await expect(provider.search('bang')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
