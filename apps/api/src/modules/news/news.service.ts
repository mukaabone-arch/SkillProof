import { Injectable } from '@nestjs/common';
import { NewsItem } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CACHE_WINDOW_DAYS, STRIP_ITEM_LIMIT } from './news.config';

@Injectable()
export class NewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The only read path GET /news uses — a pure cache read, never a fetch.
   * Two things happen here that are load-bearing, not incidental:
   *
   *  1. The 30-day age filter (CACHE_WINDOW_DAYS) — see NewsItem's own
   *     schema doc comment for why this lives here (a query filter) rather
   *     than a cleanup job. A row past the window simply isn't returned;
   *     it's still in the table.
   *  2. Returning `[]` when nothing qualifies is not a special case — an
   *     empty result and "three fresh items" go through the exact same
   *     code path here. The "render nothing, not an error, not a stuck
   *     loading state" contract is enforced by the frontend never treating
   *     an empty array as anything other than "nothing to show" (see
   *     NewsStrip.tsx), not by this method doing anything unusual.
   */
  async listRecent(): Promise<NewsItem[]> {
    const cutoff = new Date(Date.now() - CACHE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return this.prisma.newsItem.findMany({
      where: { publishedAt: { gte: cutoff } },
      orderBy: { publishedAt: 'desc' },
      take: STRIP_ITEM_LIMIT,
    });
  }
}
