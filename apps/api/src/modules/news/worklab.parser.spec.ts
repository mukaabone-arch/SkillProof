import { extractWorkLabArticleLinks, parseWorkLabArticle } from './worklab.parser';

describe('extractWorkLabArticleLinks', () => {
  it('keeps article links in page order, absolute and de-duplicated, and drops index pages', () => {
    const html = `
      <a href="/en-us/worklab/">Home</a>
      <a href="/en-us/worklab/podcast">Podcast</a>
      <a href="/en-us/worklab/work-trend-index">WTI</a>
      <a href="/en-us/worklab/aiwork-tokenomics-is-the-new-headcount-and-four-more-trends-to-watch">A</a>
      <a href="https://www.microsoft.com/en-us/worklab/podcast/andy-doyle-let-15000-agents-bloom?x=1">B</a>
      <a href="/en-us/worklab/aiwork-tokenomics-is-the-new-headcount-and-four-more-trends-to-watch#top">A again</a>
      <a href="/en-us/microsoft-365/copilot">elsewhere</a>`;
    expect(extractWorkLabArticleLinks(html)).toEqual([
      'https://www.microsoft.com/en-us/worklab/aiwork-tokenomics-is-the-new-headcount-and-four-more-trends-to-watch',
      'https://www.microsoft.com/en-us/worklab/podcast/andy-doyle-let-15000-agents-bloom',
    ]);
  });
});

describe('parseWorkLabArticle', () => {
  it('reads og:title (suffix and entities cleaned) and the byline date', () => {
    const html = `<head><meta property="og:title" content="AI@Work: Tokenomics is the new headcount&#8212;and four more | Microsoft WorkLab"></head>
      <body><p>By Someone</p><p>June 04, 2026</p></body>`;
    const r = parseWorkLabArticle(html);
    expect(r?.title).toBe('AI@Work: Tokenomics is the new headcount—and four more');
    expect(r?.publishedAt.toISOString()).toBe('2026-06-04T00:00:00.000Z');
  });

  it('falls back to <title> and the awa-stv meta date', () => {
    const html = `<title>Five years that shook the business world</title><meta name="awa-stv" content="20260115">`;
    const r = parseWorkLabArticle(html);
    expect(r?.title).toBe('Five years that shook the business world');
    expect(r?.publishedAt.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('returns null without a date rather than guessing one', () => {
    expect(parseWorkLabArticle('<title>No date here</title>')).toBeNull();
  });
});
