import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Parser from 'rss-parser';
import { PrismaService } from '../../prisma/prisma.service';
import { FEED_FETCH_TIMEOUT_MS, NEWS_SOURCES, NewsSource, PER_SOURCE_FETCH_LIMIT } from './news.config';

/**
 * The only place that ever fetches an external feed — GET /news (see
 * NewsController) only ever reads NewsItem, so a slow or dead source can
 * never slow down or break the landing page request path. No queue table
 * exists here either, same reasoning as DocumentsGenerationJob/
 * AssessmentRequestsRefundJob: a fixed, small source list polled on a
 * plain hourly @Cron is simpler than inventing scheduling infrastructure
 * this codebase doesn't otherwise have.
 *
 * Each source is fetched and upserted independently, in its own try/catch
 * — one down or slow feed is logged and skipped, never allowed to stop
 * the other two from updating (this is the actual behavior under test in
 * news-feed-refresh.job.spec.ts's "one source throws" cases, not just
 * asserted from the code shape). rss-parser's own `timeout` option (see
 * FEED_FETCH_TIMEOUT_MS) is what stops a hanging source from stalling the
 * whole sweep — every Parser instance here is constructed with it, not
 * relying on the library's default.
 */
@Injectable()
export class NewsFeedRefreshJob {
  private readonly logger = new Logger(NewsFeedRefreshJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    this.logger.log('Running news feed refresh sweep');
    for (const source of NEWS_SOURCES) {
      await this.refreshOne(source).catch((err) => {
        // refreshOne already catches its own fetch/parse errors (see
        // below) — this is a last-resort net for anything genuinely
        // unexpected, so one source's failure mode we didn't anticipate
        // still can't take down the rest of the sweep.
        this.logger.error(`Unexpected error refreshing news source ${source.name}: ${(err as Error).message}`);
      });
    }
  }

  private async refreshOne(source: NewsSource): Promise<void> {
    const parser = new Parser({ timeout: FEED_FETCH_TIMEOUT_MS });
    let feed;
    try {
      feed = await parser.parseURL(source.feedUrl);
    } catch (err) {
      this.logger.error(`Failed to fetch/parse news source ${source.name} (${source.feedUrl}): ${(err as Error).message}`);
      return;
    }

    // Newest-first, sliced to PER_SOURCE_FETCH_LIMIT — see that constant's
    // own doc comment for why this isn't optional against these specific
    // feeds (OpenAI/Hugging Face serve their full post history, not a
    // capped recent list).
    for (const item of feed.items.slice(0, PER_SOURCE_FETCH_LIMIT)) {
      if (!item.title || !item.link) continue; // malformed entry — skip it, don't let one bad item abort the rest of this source's own batch
      const publishedAt = item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : null;
      if (!publishedAt || Number.isNaN(publishedAt.getTime())) continue;

      try {
        await this.prisma.newsItem.upsert({
          where: { source_link: { source: source.name, link: item.link } },
          create: { source: source.name, title: item.title, link: item.link, publishedAt },
          update: { title: item.title, publishedAt, fetchedAt: new Date() },
        });
      } catch (err) {
        // One malformed/conflicting row must not abort the rest of this
        // source's items — same isolation principle as the per-source
        // try/catch above, one level down.
        this.logger.error(`Failed to upsert news item "${item.title}" from ${source.name}: ${(err as Error).message}`);
      }
    }
  }
}
