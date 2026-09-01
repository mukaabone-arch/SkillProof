import { NewsFeedRefreshJob } from './news-feed-refresh.job';
import { NEWS_SOURCES } from './news.config';

/**
 * rss-parser's Parser class is mocked at the module level — parseURL's
 * behavior is controlled per-URL in each test below, so a source can be
 * made to genuinely reject (simulating a broken feed) independently of
 * the others, exactly matching how AssessmentRequestsRefundJob's own spec
 * mocks gateway.refundPayment to fail for one call and succeed for the
 * next, rather than hitting a real network.
 */
const parseURLMock = jest.fn();
jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({ parseURL: parseURLMock }));
});

function fakePrisma() {
  const items: any[] = [];
  return {
    _items: items,
    newsItem: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const existing = items.find((i) => i.source === where.source_link.source && i.link === where.source_link.link);
        if (existing) {
          Object.assign(existing, { title: create.title, publishedAt: create.publishedAt });
          return existing;
        }
        const row = { id: `news-${items.length + 1}`, ...create };
        items.push(row);
        return row;
      }),
    },
  };
}

function feedItem(overrides: Partial<{ title: string; link: string; isoDate: string; pubDate: string }> = {}) {
  return { title: 'A headline', link: 'https://example.com/post', isoDate: '2026-08-30T00:00:00.000Z', ...overrides };
}

describe('NewsFeedRefreshJob', () => {
  beforeEach(() => {
    parseURLMock.mockReset();
  });

  it('upserts items from every source that succeeds', async () => {
    parseURLMock.mockImplementation(async (url: string) => {
      const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
      return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
    });
    const prisma = fakePrisma();
    const job = new NewsFeedRefreshJob(prisma as any);

    await job.run();

    expect(prisma._items).toHaveLength(NEWS_SOURCES.length);
    for (const source of NEWS_SOURCES) {
      expect(prisma._items.some((i: any) => i.source === source.name)).toBe(true);
    }
  });

  describe('one source failing does not prevent the others from updating', () => {
    it('a source in the MIDDLE of the list throwing does not block the ones before or after it', async () => {
      const [first, second, third] = NEWS_SOURCES;
      parseURLMock.mockImplementation(async (url: string) => {
        if (url === second.feedUrl) throw new Error('getaddrinfo ENOTFOUND — feed is down');
        const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
        return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
      });
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      expect(prisma._items.some((i: any) => i.source === first.name)).toBe(true);
      expect(prisma._items.some((i: any) => i.source === third.name)).toBe(true);
      expect(prisma._items.some((i: any) => i.source === second.name)).toBe(false);
      expect(prisma._items).toHaveLength(2);
    });

    it('the FIRST source throwing does not block the ones after it', async () => {
      const [first, second, third] = NEWS_SOURCES;
      parseURLMock.mockImplementation(async (url: string) => {
        if (url === first.feedUrl) throw new Error('connect ECONNREFUSED');
        const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
        return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
      });
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      expect(prisma._items.some((i: any) => i.source === second.name)).toBe(true);
      expect(prisma._items.some((i: any) => i.source === third.name)).toBe(true);
      expect(prisma._items).toHaveLength(2);
    });

    it('the LAST source throwing does not block the ones before it, and run() itself never throws', async () => {
      const [first, second, third] = NEWS_SOURCES;
      parseURLMock.mockImplementation(async (url: string) => {
        if (url === third.feedUrl) throw new Error('read ETIMEDOUT');
        const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
        return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
      });
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await expect(job.run()).resolves.toBeUndefined();

      expect(prisma._items.some((i: any) => i.source === first.name)).toBe(true);
      expect(prisma._items.some((i: any) => i.source === second.name)).toBe(true);
      expect(prisma._items).toHaveLength(2);
    });

    it('a source rejecting with a non-Error value (a raw thrown string) is still isolated, not an unhandled crash', async () => {
      const [first, second] = NEWS_SOURCES;
      parseURLMock.mockImplementation(async (url: string) => {
        if (url === first.feedUrl) throw 'not even an Error instance';
        const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
        return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
      });
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await expect(job.run()).resolves.toBeUndefined();
      expect(prisma._items.some((i: any) => i.source === second.name)).toBe(true);
    });
  });

  it('re-running upserts the same item idempotently — never a duplicate row for the same (source, link)', async () => {
    const [first] = NEWS_SOURCES;
    parseURLMock.mockImplementation(async (url: string) =>
      url === first.feedUrl ? { items: [feedItem({ title: 'Same item', link: `${url}/same` })] } : { items: [] },
    );
    const prisma = fakePrisma();
    const job = new NewsFeedRefreshJob(prisma as any);

    await job.run();
    await job.run();

    expect(prisma._items.filter((i: any) => i.link === `${first.feedUrl}/same`)).toHaveLength(1);
  });

  it('skips a malformed item with no title/link rather than crashing the whole source', async () => {
    const [first] = NEWS_SOURCES;
    parseURLMock.mockImplementation(async (url: string) =>
      url === first.feedUrl
        ? { items: [{ title: undefined, link: undefined }, feedItem({ title: 'A real item', link: `${url}/real` })] }
        : { items: [] },
    );
    const prisma = fakePrisma();
    const job = new NewsFeedRefreshJob(prisma as any);

    await job.run();

    expect(prisma._items.some((i: any) => i.title === 'A real item')).toBe(true);
    expect(prisma._items).toHaveLength(1);
  });

  it('constructs each Parser with the configured fetch timeout', async () => {
    parseURLMock.mockImplementation(async () => ({ items: [] }));
    const prisma = fakePrisma();
    const job = new NewsFeedRefreshJob(prisma as any);

    await job.run();

    const ParserCtor = jest.requireMock('rss-parser');
    expect(ParserCtor).toHaveBeenCalledWith(expect.objectContaining({ timeout: expect.any(Number) }));
  });
});
