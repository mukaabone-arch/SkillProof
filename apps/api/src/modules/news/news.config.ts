export interface NewsSource {
  /** Display name, stored verbatim on NewsItem.source and shown on the landing page strip. */
  name: string;
  feedUrl: string;
}

/**
 * The fixed source list NewsFeedRefreshJob polls hourly — investigated
 * directly (fetched every candidate URL, inspected raw XML) before this
 * list was settled, not assumed from a generic "reputable AI sources"
 * brief:
 *
 *  - arXiv cs.AI: deliberately excluded. Its RSS is a full daily bulk dump
 *    (500+ items/day, all dated with no time-of-day granularity), and
 *    every item is a dense academic paper title/abstract — the wrong
 *    shape and audience for an anonymous landing-page visitor, not a
 *    fixable noise level.
 *  - Anthropic: excluded because no RSS/Atom feed exists to poll — not a
 *    quality judgment. Checked every plausible path
 *    (/news/rss.xml, /rss.xml, /feed.xml, /rss/news, /news/feed,
 *    /research/rss.xml, /engineering/rss.xml, /index.xml, /news.rss,
 *    /news/rss), the rendered /news page's <head> for a declared
 *    <link rel="alternate" type="application/rss+xml">, and grepped their
 *    real sitemap.xml for any rss/feed/.xml reference (the only hits were
 *    research paper URLs whose slugs happen to contain the word
 *    "feedback" — not a feed). If Anthropic ever ships one, add it here;
 *    there is nothing else to change.
 *  - Meta AI: same — excluded for the same reason (no feed found at
 *    /blog/rss/, /blog/rss.xml, /blog/feed/; their declared sitemap
 *    returned an empty body even after following redirects). Not
 *    filtered for quality.
 *  - OpenAI, DeepMind, Hugging Face: all three confirmed working RSS 2.0
 *    with clean single-line headlines, real per-item timestamps, ordered
 *    newest-first, and a combined cadence (roughly daily-to-weekly across
 *    the three) that comfortably fills a handful-of-items strip within
 *    NewsService's 30-day window.
 *
 * OpenAI's URL is the canonical one — /blog/rss.xml 307-redirects to this
 * same path, so this is the direct target, not the redirect source.
 */
export const NEWS_SOURCES: NewsSource[] = [
  { name: 'OpenAI', feedUrl: 'https://openai.com/news/rss.xml' },
  { name: 'DeepMind', feedUrl: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Hugging Face', feedUrl: 'https://huggingface.co/blog/feed.xml' },
];

/** A hanging source must never stall the hourly sweep — see NewsFeedRefreshJob's own doc comment. */
export const FEED_FETCH_TIMEOUT_MS = 10_000;

/**
 * Caps how many of a feed's items NewsFeedRefreshJob even attempts to
 * upsert per sweep — confirmed necessary against real feeds, not a
 * theoretical concern: OpenAI's/Hugging Face's RSS return their FULL post
 * history on every request (1159 and 852 items respectively when
 * investigated), not a capped "recent N" like most blog feeds. Items are
 * newest-first (confirmed directly), so slicing to the first N here is
 * "the N most recent," not an arbitrary truncation. Generous relative to
 * STRIP_ITEM_LIMIT (enough headroom that combining three sources and
 * sorting by date still surfaces genuinely recent items across all of
 * them) without upserting hundreds of rows nobody will ever see, every
 * single hour, forever.
 */
export const PER_SOURCE_FETCH_LIMIT = 20;

/**
 * NewsService.listRecent()'s read-time cutoff — see NewsItem's own schema
 * doc comment for why this is a query filter, not a deletion job. Chosen
 * against the sources' real combined cadence (investigated directly, not
 * guessed): generous enough that a several-day source outage never empties
 * the strip, tight enough that a feed dead for months actually does.
 */
export const CACHE_WINDOW_DAYS = 30;

/** How many items the public strip shows — "a handful," per the brief, not a full feed reader. */
export const STRIP_ITEM_LIMIT = 6;
