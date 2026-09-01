import * as path from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { NewsService } from './news.service';

/**
 * Real Postgres, real inserted rows — proves the 30-day window (see
 * NewsItem's own schema doc comment) actually filters correctly against
 * a real query, not just a fake-Prisma mock's own bookkeeping.
 *
 * NOT tested here: "returns [] against a genuinely empty table." That was
 * the original intent of this file, and it held right up until a
 * `nest start --watch` process already running in this dev environment
 * picked up NewsModule the moment it was wired into app.module.ts and the
 * real hourly @Cron genuinely fired against the real feeds mid-session —
 * confirmed by inspecting the table afterward (1159 OpenAI / 852 Hugging
 * Face / 100 DeepMind real rows, matching each feed's real item count
 * from the earlier investigation exactly). That's good evidence the job
 * works end-to-end against real sources; it also means this shared dev
 * database can no longer host a literal "physically empty table" test
 * without deleting real, correctly-cached data, which this file won't do.
 * The empty-table guarantee is proven instead at two other layers:
 * NewsService.listRecent's own fake-Prisma unit test ("returns [] when
 * the table is empty," deterministic, unaffected by what's actually in
 * any real database) and NewsStrip.spec.tsx's real-RTL-render test
 * against a mocked empty API response (the half of the contract that
 * actually matters most — the frontend correctly doing nothing with it).
 */
const describeIfDb = process.env.CI || process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('NewsService.listRecent — real Postgres, the 30-day window', () => {
  let prisma: PrismaClient;
  let service: NewsService;
  const testMarker = `news-integration-test-${Date.now()}`;
  const staleLink = `https://example.com/${testMarker}/stale`;
  const freshLink = `https://example.com/${testMarker}/fresh`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new NewsService(prisma as any);
  });

  afterEach(async () => {
    await prisma.newsItem.deleteMany({ where: { link: { in: [staleLink, freshLink] } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a fresh item published right now outranks everything else and is returned', async () => {
    await prisma.newsItem.create({
      data: { source: testMarker, title: 'Fresh item', link: freshLink, publishedAt: new Date() },
    });

    const result = await service.listRecent();

    // Newest-first, capped at STRIP_ITEM_LIMIT — a freshly-published item
    // is, by construction, at least tied for most recent in the whole
    // table, so it must be rank #1 regardless of how much other real
    // cached data coexists here.
    expect(result[0]?.link).toBe(freshLink);
  });

  it('a 40-day-old item is excluded even though it is genuinely in the table', async () => {
    await prisma.newsItem.create({
      data: {
        source: testMarker,
        title: 'Stale item',
        link: staleLink,
        publishedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      },
    });

    const result = await service.listRecent();

    expect(result.some((r) => r.link === staleLink)).toBe(false);
  });

  it('a 400-day-old item is excluded, and the row itself is untouched — filtered at read time, never deleted', async () => {
    await prisma.newsItem.create({
      data: {
        source: testMarker,
        title: 'Long dead',
        link: staleLink,
        publishedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
      },
    });

    const result = await service.listRecent();
    expect(result.some((r) => r.link === staleLink)).toBe(false);

    const stillInTable = await prisma.newsItem.findUnique({ where: { source_link: { source: testMarker, link: staleLink } } });
    expect(stillInTable).not.toBeNull();
  });
});
