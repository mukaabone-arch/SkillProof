import { NewsService } from './news.service';
import { CACHE_WINDOW_DAYS, STRIP_ITEM_LIMIT } from './news.config';

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

  it(`caps at STRIP_ITEM_LIMIT (${STRIP_ITEM_LIMIT}) even when more qualify`, async () => {
    const items = Array.from({ length: STRIP_ITEM_LIMIT + 4 }, (_, i) => ({
      id: String(i),
      source: 'OpenAI',
      title: `Item ${i}`,
      link: `https://x/${i}`,
      publishedAt: daysAgo(i),
    }));
    const service = new NewsService(fakePrisma(items) as any);

    const result = await service.listRecent();

    expect(result).toHaveLength(STRIP_ITEM_LIMIT);
  });
});
