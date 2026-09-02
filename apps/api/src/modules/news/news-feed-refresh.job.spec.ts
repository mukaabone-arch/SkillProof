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
      const failing = NEWS_SOURCES[Math.floor(NEWS_SOURCES.length / 2)];
      parseURLMock.mockImplementation(async (url: string) => {
        if (url === failing.feedUrl) throw new Error('getaddrinfo ENOTFOUND — feed is down');
        const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
        return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
      });
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      for (const source of NEWS_SOURCES) {
        expect(prisma._items.some((i: any) => i.source === source.name)).toBe(source.name !== failing.name);
      }
      expect(prisma._items).toHaveLength(NEWS_SOURCES.length - 1);
    });

    it('the FIRST source throwing does not block the ones after it', async () => {
      const failing = NEWS_SOURCES[0];
      parseURLMock.mockImplementation(async (url: string) => {
        if (url === failing.feedUrl) throw new Error('connect ECONNREFUSED');
        const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
        return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
      });
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      for (const source of NEWS_SOURCES.slice(1)) {
        expect(prisma._items.some((i: any) => i.source === source.name)).toBe(true);
      }
      expect(prisma._items).toHaveLength(NEWS_SOURCES.length - 1);
    });

    it('the LAST source throwing does not block the ones before it, and run() itself never throws', async () => {
      const failing = NEWS_SOURCES[NEWS_SOURCES.length - 1];
      parseURLMock.mockImplementation(async (url: string) => {
        if (url === failing.feedUrl) throw new Error('read ETIMEDOUT');
        const source = NEWS_SOURCES.find((s) => s.feedUrl === url)!;
        return { items: [feedItem({ title: `${source.name} item`, link: `${url}/1` })] };
      });
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await expect(job.run()).resolves.toBeUndefined();

      for (const source of NEWS_SOURCES.slice(0, -1)) {
        expect(prisma._items.some((i: any) => i.source === source.name)).toBe(true);
      }
      expect(prisma._items).toHaveLength(NEWS_SOURCES.length - 1);
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

  describe('decoding HTML entities in a title', () => {
    it('decodes a numeric entity that rss-parser left literal — the actual shape of a CDATA-wrapped title (e.g. The Verge\'s Atom feed)', async () => {
      const [first] = NEWS_SOURCES;
      parseURLMock.mockImplementation(async (url: string) =>
        url === first.feedUrl
          ? { items: [feedItem({ title: 'Anthropic launches Claude Fable 5.1 and says it&#8217;s cheaper', link: `${url}/1` })] }
          : { items: [] },
      );
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      expect(prisma._items[0].title).toBe('Anthropic launches Claude Fable 5.1 and says it’s cheaper');
    });

    it('decodes named and numeric entities together (Hugging Face/Ars Technica style)', async () => {
      const [first] = NEWS_SOURCES;
      parseURLMock.mockImplementation(async (url: string) =>
        url === first.feedUrl
          ? { items: [feedItem({ title: 'Fast &amp; Local: H Company&apos;s new &quot;Holo&quot; model', link: `${url}/1` })] }
          : { items: [] },
      );
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      expect(prisma._items[0].title).toBe('Fast & Local: H Company\'s new "Holo" model');
    });

    it('leaves a title with no entities untouched — decoding is a no-op, not a transform every title goes through', async () => {
      const [first] = NEWS_SOURCES;
      const clean = 'OpenAI supports California’s bill to advance youth AI safety';
      parseURLMock.mockImplementation(async (url: string) =>
        url === first.feedUrl ? { items: [feedItem({ title: clean, link: `${url}/1` })] } : { items: [] },
      );
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      expect(prisma._items[0].title).toBe(clean);
    });

    it('decodes entities without ever producing markup — a title with an escaped angle bracket decodes to a literal character, not parsed HTML, so it stays plain text', async () => {
      const [first] = NEWS_SOURCES;
      parseURLMock.mockImplementation(async (url: string) =>
        url === first.feedUrl
          ? { items: [feedItem({ title: 'Study finds &lt;script&gt; tags in 12% of scraped datasets', link: `${url}/1` })] }
          : { items: [] },
      );
      const prisma = fakePrisma();
      const job = new NewsFeedRefreshJob(prisma as any);

      await job.run();

      // The decoded string legitimately contains literal "<"/">" characters
      // now — that's correct entity decoding, not an HTML-injection bug.
      // Safety here comes from the render side (NewsStrip.tsx's plain JSX
      // text interpolation, never dangerouslySetInnerHTML), not from
      // withholding the decode.
      expect(prisma._items[0].title).toBe('Study finds <script> tags in 12% of scraped datasets');
    });
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
