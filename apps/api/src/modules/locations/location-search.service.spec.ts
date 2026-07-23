import { HttpException } from '@nestjs/common';
import { LocationSearchService } from './location-search.service';
import { LocationSearchProvider, LocationSuggestion } from './location-search-provider.interface';

function suggestion(city: string): LocationSuggestion {
  return { placeId: city, city, region: null, country: 'IN', lat: 0, lng: 0 };
}

class FakeProvider implements LocationSearchProvider {
  calls: string[] = [];
  async search(query: string): Promise<LocationSuggestion[]> {
    this.calls.push(query);
    return [suggestion(query)];
  }
}

describe('LocationSearchService', () => {
  it('caches identical queries — the provider is only called once', async () => {
    const provider = new FakeProvider();
    const svc = new LocationSearchService(provider);

    await svc.search('user-1', 'bangalore');
    await svc.search('user-1', 'bangalore');
    await svc.search('user-2', 'Bangalore'); // different case, same normalized key

    expect(provider.calls).toEqual(['bangalore']);
  });

  it('below the minimum query length, returns [] without calling the provider', async () => {
    const provider = new FakeProvider();
    const svc = new LocationSearchService(provider);

    const result = await svc.search('user-1', 'b');

    expect(result).toEqual([]);
    expect(provider.calls).toEqual([]);
  });

  it('rate-limits a single user after too many searches in the window', async () => {
    const provider = new FakeProvider();
    const svc = new LocationSearchService(provider);

    // Distinct queries so the cache can't mask the count.
    for (let i = 0; i < 30; i++) {
      await svc.search('user-1', `city-${i}`);
    }

    await expect(svc.search('user-1', 'city-31')).rejects.toBeInstanceOf(HttpException);
  });

  it('rate limiting is scoped per user — a different user is unaffected', async () => {
    const provider = new FakeProvider();
    const svc = new LocationSearchService(provider);

    for (let i = 0; i < 30; i++) {
      await svc.search('user-1', `city-${i}`);
    }

    await expect(svc.search('user-2', 'some-city')).resolves.toEqual([suggestion('some-city')]);
  });
});
