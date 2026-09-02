import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { decodeHTML } from 'entities';
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

      // decodeHTML, not the parser's own decoding: rss-parser (via xml2js)
      // only decodes entities that sit in plain XML character data — a
      // title wrapped in <![CDATA[...]]> (The Verge does this for every
      // item, per its own Atom type="html" convention) is passed through
      // completely untouched by XML parsing, since CDATA's entire point is
      // "don't interpret this." The literal text "&#8217;s" was reaching
      // the DB and the page verbatim, not a double-decode — see the PR
      // description for the raw-XML investigation. Applied to every
      // source's title uniformly (not just The Verge's) since this is a
      // property of how a given source's feed happens to be generated, not
      // something to special-case per source name — a no-op for a title
      // with no entities in it (confirmed against all seven sources' real
      // feeds: only The Verge's items actually change). Title only, not
      // link — a link's entities (e.g. a literal `&` in a query string,
      // written as `&amp;` per the XML spec) are never CDATA-wrapped in any
      // of these feeds and are already correctly decoded by the XML parser
      // itself; running decodeHTML on it too is unnecessary.
      //
      // Safe against XSS: decodeHTML turns entity text back into the
      // literal characters they represent (e.g. "&lt;" -> "<") — it does
      // NOT parse or execute HTML. The result is stored as plain text and
      // is only ever rendered via NewsStrip.tsx's plain JSX text
      // interpolation ({item.title}), which React escapes on render;
      // nothing in this codebase renders a NewsItem via
      // dangerouslySetInnerHTML or similar. Decoding entities earlier
      // (here) rather than at render time keeps that guarantee centralized
      // at the one place untrusted feed content enters the system, instead
      // of depending on every future consumer remembering to decode too.
      const title = decodeHTML(item.title);

      try {
        await this.prisma.newsItem.upsert({
          where: { source_link: { source: source.name, link: item.link } },
          create: { source: source.name, title, link: item.link, publishedAt },
          update: { title, publishedAt, fetchedAt: new Date() },
        });
      } catch (err) {
        // One malformed/conflicting row must not abort the rest of this
        // source's items — same isolation principle as the per-source
        // try/catch above, one level down.
        this.logger.error(`Failed to upsert news item "${title}" from ${source.name}: ${(err as Error).message}`);
      }
    }
  }
}
