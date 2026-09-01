import { NewsService } from './news.service';
import { CACHE_WINDOW_DAYS, MAX_ITEMS_PER_SOURCE, STRIP_ITEM_LIMIT } from './news.config';

function fakePrisma(items: any[]) {
  return {
    newsItem: {
      findMany: jest.fn(async ({ where, orderBy, take }: any) => {
        const cutoff = where.publishedAt.gte as Date;
        const filtered = items.filter((i) => i.publishedAt >= cutoff);
        filtered.sort((a, b) => (orderBy.publishedAt === 'desc' ? b.publishedAt - a.publishedAt : a.publishedAt - b.publishedAt));
        return filtered.slice(0, take);
      }),
    },
  };
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe('NewsService.listRecent', () => {
  it('returns [] when the table is empty — the exact case the landing page relies on to render nothing', async () => {
    const service = new NewsService(fakePrisma([]) as any);
    expect(await service.listRecent()).toEqual([]);
  });

  it(`excludes items older than the ${CACHE_WINDOW_DAYS}-day window`, async () => {
    const stale = { id: '1', source: 'OpenAI', title: 'Old', link: 'https://x/1', publishedAt: daysAgo(CACHE_WINDOW_DAYS + 5) };
    const fresh = { id: '2', source: 'OpenAI', title: 'New', link: 'https://x/2', publishedAt: daysAgo(1) };
    const service = new NewsService(fakePrisma([stale, fresh]) as any);

    const result = await service.listRecent();

    expect(result.map((r) => r.id)).toEqual(['2']);
  });

  it('returns [] when everything cached is past the window — a permanently-dead feed does not sit there looking current', async () => {
    const allStale = [
      { id: '1', source: 'OpenAI', title: 'Old 1', link: 'https://x/1', publishedAt: daysAgo(90) },
      { id: '2', source: 'DeepMind', title: 'Old 2', link: 'https://x/2', publishedAt: daysAgo(60) },
    ];
    const service = new NewsService(fakePrisma(allStale) as any);
    expect(await service.listRecent()).toEqual([]);
  });

  it('orders newest first', async () => {
    const older = { id: '1', source: 'OpenAI', title: 'Older', link: 'https://x/1', publishedAt: daysAgo(3) };
    const newer = { id: '2', source: 'OpenAI', title: 'Newer', link: 'https://x/2', publishedAt: daysAgo(1) };
    const service = new NewsService(fakePrisma([older, newer]) as any);

    const result = await service.listRecent();

    expect(result.map((r) => r.id)).toEqual(['2', '1']);
  });

  it(`caps at STRIP_ITEM_LIMIT (${STRIP_ITEM_LIMIT}) even when more qualify, spread across enough sources that the per-source cap never binds`, async () => {
    // One item per source so MAX_ITEMS_PER_SOURCE can't be what's limiting
    // the result here — STRIP_ITEM_LIMIT has to be the thing doing it.
    const items = Array.from({ length: STRIP_ITEM_LIMIT + 4 }, (_, i) => ({
      id: String(i),
      source: `Source ${i}`,
      title: `Item ${i}`,
      link: `https://x/${i}`,
      publishedAt: daysAgo(i),
    }));
    const service = new NewsService(fakePrisma(items) as any);

    const result = await service.listRecent();

    expect(result).toHaveLength(STRIP_ITEM_LIMIT);
  });

  it(`caps a single dominant source at MAX_ITEMS_PER_SOURCE (${MAX_ITEMS_PER_SOURCE}) even though it has the most recent items overall`, async () => {
    // Mirrors the real production case this was added for: one publisher
    // posts far more often than the others and would otherwise fill the
    // whole strip on recency alone.
    const dominant = Array.from({ length: 5 }, (_, i) => ({
      id: `openai-${i}`,
      source: 'OpenAI',
      title: `OpenAI item ${i}`,
      link: `https://openai/${i}`,
      publishedAt: daysAgo(i), // 0..4 days ago — newer than every DeepMind item below
    }));
    const rare = { id: 'deepmind-1', source: 'DeepMind', title: 'DeepMind item', link: 'https://deepmind/1', publishedAt: daysAgo(10) };
    const service = new NewsService(fakePrisma([...dominant, rare]) as any);

    const result = await service.listRecent();

    expect(result.filter((r) => r.source === 'OpenAI')).toHaveLength(MAX_ITEMS_PER_SOURCE);
    expect(result.some((r) => r.source === 'DeepMind')).toBe(true);
  });

  it('fills remaining slots by recency after applying the per-source cap, not by re-including a capped source', async () => {
    const openai = Array.from({ length: 3 }, (_, i) => ({
      id: `openai-${i}`,
      source: 'OpenAI',
      title: `OpenAI item ${i}`,
      link: `https://openai/${i}`,
      publishedAt: daysAgo(i), // 0, 1, 2 days ago
    }));
    const deepmind = { id: 'deepmind-1', source: 'DeepMind', title: 'DeepMind item', link: 'https://deepmind/1', publishedAt: daysAgo(3) };
    const service = new NewsService(fakePrisma([...openai, deepmind]) as any);

    const result = await service.listRecent();

    // Newest-first: OpenAI(0), OpenAI(1) fill the cap; OpenAI(2) is skipped
    // even though it's more recent than DeepMind's item, which fills the
    // next slot instead.
    expect(result.map((r) => r.id)).toEqual(['openai-0', 'openai-1', 'deepmind-1']);
  });
});
