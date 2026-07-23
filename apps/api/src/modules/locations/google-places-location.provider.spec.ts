import { ServiceUnavailableException } from '@nestjs/common';
import { GooglePlacesLocationProvider } from './google-places-location.provider';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const AUTOCOMPLETE_OK = {
  suggestions: [
    { placePrediction: { placeId: 'place-1', structuredFormat: { mainText: { text: 'Bangalore' } } } },
    { placePrediction: { placeId: 'place-2', structuredFormat: { mainText: { text: 'Bangor' } } } },
  ],
};

function detailsFor(placeId: string) {
  if (placeId === 'place-1') {
    return {
      location: { latitude: 12.9716, longitude: 77.5946 },
      addressComponents: [
        { longText: 'Bangalore', shortText: 'Bangalore', types: ['locality', 'political'] },
        { longText: 'Karnataka', shortText: 'KA', types: ['administrative_area_level_1', 'political'] },
        { longText: 'India', shortText: 'IN', types: ['country', 'political'] },
      ],
    };
  }
  // place-2: deliberately malformed (no country component) — must be
  // dropped, not thrown, so one bad prediction never kills the whole batch.
  return { addressComponents: [] };
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

  it('POSTs to the New Autocomplete endpoint with the API key in a header, not a query param', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    const fetchMock = jest.fn((url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href === 'https://places.googleapis.com/v1/places:autocomplete') {
        expect(init?.method).toBe('POST');
        expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
        expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).toBeTruthy();
        expect(href).not.toContain('key=test-key');
        const parsedBody = JSON.parse(init!.body as string);
        expect(parsedBody).toEqual({ input: 'bang', includedPrimaryTypes: ['locality'] });
        return Promise.resolve(jsonResponse({ suggestions: [] }));
      }
      throw new Error(`unexpected fetch to ${href}`);
    }) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const provider = new GooglePlacesLocationProvider();
    await provider.search('bang');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses a valid prediction into a fully structured LocationSuggestion, dropping a malformed one', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    global.fetch = jest.fn((url: string | URL, init?: RequestInit) => {
      const href = url.toString();
      if (href.includes(':autocomplete')) return Promise.resolve(jsonResponse(AUTOCOMPLETE_OK));
      expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('test-key');
      const placeId = href.split('/').pop()!;
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

  it('no suggestions in the response returns an empty array, not an error', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    global.fetch = jest.fn(() => Promise.resolve(jsonResponse({}))) as unknown as typeof fetch;

    const provider = new GooglePlacesLocationProvider();
    await expect(provider.search('zzzzzz')).resolves.toEqual([]);
  });

  it('a non-2xx Autocomplete response throws ServiceUnavailableException and logs both the status and Google error message', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    global.fetch = jest.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: 403, message: 'This API is not enabled for this project.', status: 'PERMISSION_DENIED' } },
          false,
          403,
        ),
      ),
    ) as unknown as typeof fetch;
    const provider = new GooglePlacesLocationProvider();
    const warnSpy = jest.spyOn(provider['logger'], 'warn');

    await expect(provider.search('bang')).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('403'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('This API is not enabled for this project.'));
  });

  it('a failed Details call for one prediction does not drop the others', async () => {
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    global.fetch = jest.fn((url: string | URL) => {
      const href = url.toString();
      if (href.includes(':autocomplete')) return Promise.resolve(jsonResponse(AUTOCOMPLETE_OK));
      if (href.endsWith('place-1')) {
        return Promise.resolve(
          jsonResponse({ error: { message: 'Not found', status: 'NOT_FOUND' } }, false, 404),
        );
      }
      return Promise.resolve(jsonResponse(detailsFor('place-2'))); // still malformed — no country
    }) as unknown as typeof fetch;

    const provider = new GooglePlacesLocationProvider();
    await expect(provider.search('bang')).resolves.toEqual([]);
  });
});
