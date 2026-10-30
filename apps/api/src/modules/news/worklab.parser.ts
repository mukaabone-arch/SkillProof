import { decodeHTML } from 'entities';

/**
 * Microsoft WorkLab (microsoft.com/en-us/worklab) has no RSS/Atom feed, so
 * NewsFeedRefreshJob.refreshWorkLab reads its index page and each article
 * page directly. These are the pure parsing halves of that, kept separate
 * so they're unit-testable against fixed HTML (see worklab.parser.spec.ts)
 * with no network. Plain regex over the HTML, no DOM library: we only need
 * hrefs, one <meta>/<title>, and a "Month DD, YYYY" date line.
 *
 * Everything returned is plain text; titles are entity-decoded here, the
 * same single choke point as the RSS path (see the job's decodeHTML
 * comment), and only ever rendered via React text interpolation.
 */

const ORIGIN = 'https://www.microsoft.com';
const PATH_PREFIX = '/en-us/worklab/';

/**
 * Index/section pages share the /en-us/worklab/ prefix with articles but
 * aren't articles. Article slugs are long hyphenated sentences, so the
 * slug-shape check below already drops most of these; this list catches
 * the short ones explicitly.
 */
const NON_ARTICLE = new Set(['', 'podcast', 'podcast/', 'work-trend-index', 'work-trend-index/', 'sitemap', 'search']);

/**
 * Article URLs in page order (the index lists Featured first, newest-ish),
 * de-duplicated, absolute, without query/fragment.
 */
export function extractWorkLabArticleLinks(indexHtml: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /href="((?:https:\/\/www\.microsoft\.com)?\/en-us\/worklab\/[^"#?]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(indexHtml)) !== null) {
    const path = m[1].replace(ORIGIN, '');
    const rest = path.slice(PATH_PREFIX.length).replace(/\/+$/, '');
    if (NON_ARTICLE.has(rest)) continue;
    const slug = rest.split('/').pop() ?? '';
    // Article slugs read like headlines: long, several hyphens.
    if (slug.length < 20 || (slug.match(/-/g) ?? []).length < 3) continue;
    const url = `${ORIGIN}${PATH_PREFIX}${rest}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * Title + publication date from one article page, or null if either is
 * missing (an item with no trustworthy date is skipped, never guessed —
 * NewsService orders and windows on publishedAt).
 */
export function parseWorkLabArticle(html: string): { title: string; publishedAt: Date } | null {
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i.exec(html)
    ?? /<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i.exec(html);
  const tag = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const raw = og?.[1] ?? tag?.[1];
  if (!raw) return null;
  const title = decodeHTML(raw)
    .replace(/\s*[|\-–]\s*Microsoft\s+WorkLab\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return null;

  let publishedAt: Date | null = null;
  const text = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/.exec(html);
  if (text) {
    publishedAt = new Date(Date.UTC(Number(text[3]), MONTHS.indexOf(text[1].toLowerCase()), Number(text[2])));
  } else {
    const stv = /awa-stv[^>]*content="(\d{4})(\d{2})(\d{2})"/i.exec(html);
    if (stv) publishedAt = new Date(Date.UTC(Number(stv[1]), Number(stv[2]) - 1, Number(stv[3])));
  }
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return null;
  return { title, publishedAt };
}
