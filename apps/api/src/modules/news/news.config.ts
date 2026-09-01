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
 *
 * Second investigation pass (widening past vendor blogs, since three
 * companies talking about themselves reads as commercially skewed, not as
 * "what's happening in AI"):
 *
 *  - Google Research: confirmed working RSS 2.0, newest-first, genuine
 *    research content (foundation models, papers, systems work) — same
 *    "returns way more than a capped recent list" shape as OpenAI/Hugging
 *    Face (100 items spanning ~10 months in one fetch), already handled by
 *    PER_SOURCE_FETCH_LIMIT below, not a new problem.
 *  - Google AI Blog (blog.google/technology/ai/rss/): excluded. The feed
 *    itself works, but the content is general Google product marketing
 *    loosely tagged "AI" (Search travel-planning features, Sheets canvas,
 *    a Gemini/Pixel football sponsorship) rather than AI-focused editorial
 *    — it would dilute the strip, and Google Research already represents
 *    this company's voice with substantially better signal. A content
 *    judgment, not a feed failure.
 *  - Import AI (Jack Clark): confirmed working RSS 2.0 at the canonical
 *    jack-clark.net/feed/ (importai.net/feed 301s here — used the direct
 *    target, same reasoning as the OpenAI URL above). Independent weekly
 *    analyst newsletter, not a company blog — 10 items spanning ~10 weeks,
 *    nowhere near a dump.
 *  - Ars Technica AI section: confirmed working RSS 2.0, section-scoped
 *    (not the whole site), independent tech journalism — 20 items
 *    spanning about a week.
 *  - The Verge AI section: confirmed working, but it's Atom not RSS 2.0
 *    (rss-parser handles both transparently — verified directly against
 *    the real feed file, item.title/link/isoDate all populate correctly).
 *    Independent tech journalism, section-scoped — 10 items spanning
 *    about 4 days.
 *  - BAIR Blog: NOT added. bair.berkeley.edu timed out on every attempt
 *    from two independent network paths, so a feed there could not be
 *    confirmed to return usable items. Not ruled out permanently — worth
 *    rechecking later — just excluded for now on "confirm it actually
 *    works" grounds, same bar every other source here was held to.
 *  - The Batch (deeplearning.ai): NOT added, same reason as Anthropic
 *    above — no feed exists. No <link rel="alternate" type="application/
 *    rss+xml"> in the page head, no visible RSS link on the page, and the
 *    sitemap has zero rss/feed URLs (only "human-feedback"/"…-feedback"
 *    slugs matched a naive grep — the same false-positive pattern already
 *    noted for Anthropic, not a real feed).
 *  - PwC: NOT added. Their RSS page lists only two general corporate-news
 *    feeds (global press releases, PwC Australia media centre), no
 *    AI-specific feed, on a page last modified 2024 with FeedBurner URLs
 *    of uncertain longevity.
 */
export const NEWS_SOURCES: NewsSource[] = [
  { name: 'OpenAI', feedUrl: 'https://openai.com/news/rss.xml' },
  { name: 'DeepMind', feedUrl: 'https://deepmind.google/blog/rss.xml' },
  { name: 'Hugging Face', feedUrl: 'https://huggingface.co/blog/feed.xml' },
  { name: 'Google Research', feedUrl: 'https://research.google/blog/rss/' },
  { name: 'Import AI', feedUrl: 'https://jack-clark.net/feed/' },
  { name: 'Ars Technica', feedUrl: 'https://arstechnica.com/ai/feed/' },
  { name: 'The Verge', feedUrl: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
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

/**
 * How many of the STRIP_ITEM_LIMIT slots a single source can occupy —
 * enforced in NewsService.listRecent, not here or at fetch time. Without
 * this, a high-frequency publisher (OpenAI posting several times a week)
 * can fill the whole strip while a weekly one (DeepMind, Import AI) never
 * appears, even though both are current — confirmed happening in
 * production before this cap existed (five OpenAI items, one Hugging
 * Face, zero DeepMind). Two isn't "one voice dominates" but still lets a
 * source that's had a genuinely big week show more than a single item.
 */
export const MAX_ITEMS_PER_SOURCE = 2;
