import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  LOCATION_SEARCH_PROVIDER,
  LocationSearchProvider,
  LocationSuggestion,
} from './location-search-provider.interface';

/** NestJS has no built-in 429 exception, so we define one (same as AuthService's OTP rate limiting). */
class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

interface CacheEntry {
  suggestions: LocationSuggestion[];
  expiresAt: number;
}

interface RateEntry {
  windowStart: number;
  count: number;
}

/**
 * Wraps the injected LocationSearchProvider (Google Places today) with
 * caching and per-user rate limiting, so GET /locations/search can sit
 * directly behind a client typeahead without either forwarding every
 * keystroke to a billed API or letting one candidate script requests.
 *
 * PRODUCTION TODO (same shape as AuthService's OTP store): move both Maps
 * to Redis so this survives restarts and scales across instances — in-memory
 * is explicitly fine for now (see this task's own framing).
 */
@Injectable()
export class LocationSearchService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly rateLimits = new Map<string, RateEntry>();

  /** City results don't change minute to minute — an hour keeps repeated
   * prefixes ("Bang", "Banga", "Bangal", "Bangalore") to a single billed
   * Autocomplete+Details round trip per city, per hour, across every
   * candidate searching that prefix. */
  private readonly CACHE_TTL_MS = 60 * 60 * 1000;
  /** Bounds memory for an otherwise-unbounded query cache — a plain FIFO
   * eviction (see setCache), not a true LRU; fine for a same-process,
   * best-effort cache. */
  private readonly MAX_CACHE_ENTRIES = 500;

  private readonly RATE_WINDOW_MS = 60 * 1000;
  /** Generous enough for real typing behind a ~300ms client debounce
   * (well under one request per second even typing continuously), tight
   * enough to make scripted abuse of a billed API pointless. */
  private readonly MAX_REQUESTS_PER_WINDOW = 30;

  constructor(@Inject(LOCATION_SEARCH_PROVIDER) private readonly provider: LocationSearchProvider) {}

  async search(userId: string, rawQuery: string): Promise<LocationSuggestion[]> {
    this.assertNotRateLimited(userId);

    const query = rawQuery.trim();
    // Below this, Autocomplete has nothing meaningful to match on anyway —
    // returning early here (in addition to LocationSearchDto's own
    // @MinLength) means a client that bypasses validation still can't
    // spend a billed call on a 0-1 char query.
    if (query.length < 2) return [];

    const key = query.toLowerCase();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.suggestions;

    const suggestions = await this.provider.search(query);
    this.setCache(key, suggestions);
    return suggestions;
  }

  private setCache(key: string, suggestions: LocationSuggestion[]): void {
    if (this.cache.size >= this.MAX_CACHE_ENTRIES && !this.cache.has(key)) {
      // Map preserves insertion order, so the first key iterated is the
      // oldest entry — simple FIFO eviction.
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { suggestions, expiresAt: Date.now() + this.CACHE_TTL_MS });
  }

  private assertNotRateLimited(userId: string): void {
    const now = Date.now();
    const entry = this.rateLimits.get(userId);
    if (!entry || now - entry.windowStart > this.RATE_WINDOW_MS) {
      this.rateLimits.set(userId, { windowStart: now, count: 1 });
      return;
    }
    if (entry.count >= this.MAX_REQUESTS_PER_WINDOW) {
      throw new TooManyRequestsException('Too many location searches — slow down and try again shortly.');
    }
    entry.count += 1;
  }
}
