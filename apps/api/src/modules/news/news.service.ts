import { Injectable } from '@nestjs/common';
import { NewsItem } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CACHE_WINDOW_DAYS,
  MAX_ITEMS_PER_SOURCE,
  STRIP_ITEM_LIMIT,
  WORKLAB_PINNED_SLOTS,
  WORKLAB_SOURCE_NAME,
  WORKLAB_WINDOW_DAYS,
} from './news.config';

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The only read path GET /news uses — a pure cache read, never a fetch.
   * Three things happen here that are load-bearing, not incidental:
   *
   *  1. The 30-day age filter (CACHE_WINDOW_DAYS) — see NewsItem's own
   *     schema doc comment for why this lives here (a query filter) rather
   *     than a cleanup job. A row past the window simply isn't returned;
   *     it's still in the table.
   *  2. The per-source cap (MAX_ITEMS_PER_SOURCE) — deliberately applied
   *     here, in JS after the read, not as a `take` in the query or as a
   *     window-function query. The candidate set within a 30-day window
   *     across a handful of sources is small, so walking it once in memory
   *     is simpler than a PARTITION BY query for the same result, and it's
   *     trivial to unit test in isolation (see news.service.spec.ts).
   *     Query is newest-first with no `take`, so every in-window row is a
   *     candidate; the loop below then walks that list once, skipping a
   *     source once it already has MAX_ITEMS_PER_SOURCE selected, and
   *     stops as soon as STRIP_ITEM_LIMIT slots are filled. Net effect:
   *     "the STRIP_ITEM_LIMIT most recent items, at most
   *     MAX_ITEMS_PER_SOURCE per source" — a high-frequency source can no
   *     longer crowd out a weekly one just by posting more often.
   *  3. Returning `[]` when nothing qualifies is not a special case — an
   *     empty result and "three fresh items" go through the exact same
   *     code path here. The "render nothing, not an error, not a stuck
   *     loading state" contract is enforced by the frontend never treating
   *     an empty array as anything other than "nothing to show" (see
   *     NewsStrip.tsx), not by this method doing anything unusual.
   */
  async listRecent(): Promise<NewsItem[]> {
    const cutoff = new Date(Date.now() - CACHE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // WorkLab rows come back under their own, longer window (see
    // WORKLAB_WINDOW_DAYS); every other source keeps the 30-day one. Still
    // one query, newest-first.
    const workLabCutoff = new Date(Date.now() - WORKLAB_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.newsItem.findMany({
      where: {
        OR: [
          { source: { not: WORKLAB_SOURCE_NAME }, publishedAt: { gte: cutoff } },
          { source: WORKLAB_SOURCE_NAME, publishedAt: { gte: workLabCutoff } },
        ],
      },
      orderBy: { publishedAt: 'desc' },
    });

    // Reserved slots first: the newest WORKLAB_PINNED_SLOTS WorkLab items.
    const pinned = candidates.filter((i) => i.source === WORKLAB_SOURCE_NAME).slice(0, WORKLAB_PINNED_SLOTS);
    const remaining = STRIP_ITEM_LIMIT - pinned.length;

    const perSourceCount = new Map<string, number>();
    const selected: NewsItem[] = [];
    for (const item of candidates) {
      if (selected.length >= remaining) break;
      if (item.source === WORKLAB_SOURCE_NAME) continue;
      const count = perSourceCount.get(item.source) ?? 0;
      if (count >= MAX_ITEMS_PER_SOURCE) continue;
      selected.push(item);
      perSourceCount.set(item.source, count + 1);
    }
    return [...selected, ...pinned].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }
}
