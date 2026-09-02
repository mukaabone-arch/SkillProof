'use client';

/**
 * Public, unauthenticated AI-news strip for anonymous landing-page
 * visitors — a credibility/freshness signal, not a candidate-retention
 * feature. Raw headlines only (title/source/link/date), never
 * AI-summarized, never personalized — GET /news is a pure read against a
 * server-side Postgres cache (see apps/api's NewsService/
 * NewsFeedRefreshJob); this component never fetches an RSS feed itself.
 *
 * Renders the WHOLE section or nothing — never just the item list. An
 * eyebrow/heading with an empty list under it would still be "something
 * broken-looking," not "nothing," so the empty/loading/error cases below
 * all return null for the entire section, not just skip the items.
 * Client-fetched (useEffect, not SSR) specifically so a slow or down API
 * can never delay the landing page's own initial paint — the strip
 * simply doesn't appear yet, or doesn't appear at all, either of which is
 * fine for a below-the-fold credibility signal and never fine for the
 * page's actual job (conversion).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface NewsItemView {
  id: string;
  source: string;
  title: string;
  link: string;
  publishedAt: string;
}

export default function NewsStrip() {
  // null = not loaded yet (or failed) -> render nothing, same as an empty
  // result. There is deliberately no separate loading state rendered
  // anywhere below — see this component's own doc comment.
  const [items, setItems] = useState<NewsItemView[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<NewsItemView[]>('/news')
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch(() => {
        // Fail open, silently — a broken/slow API must never surface an
        // error on the landing page's conversion surface. Leaves `items`
        // at null, which renders nothing, same as "API returned []."
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <section className="lp-section" aria-labelledby="lp-news-heading">
      <div className="lp-container">
        <p className="lp-section-eyebrow">Live from the field</p>
        <h2 id="lp-news-heading" className="lp-section-title">
          What&apos;s moving in AI
        </h2>
        <div className="lp-news-card">
          <ul className="lp-news-strip">
            {items.map((item) => (
              <li key={item.id} className="lp-news-item">
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="lp-news-item-title">
                  {item.title}
                </a>
                <span className="lp-news-item-meta">
                  {item.source} · {new Date(item.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
