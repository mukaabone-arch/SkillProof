'use client';

/**
 * GET /profiles/me/viewers (profile-views module) — count_only for Free,
 * full viewer detail for Premium. The canonical locked-state example from
 * the product spec: "4 employers viewed your profile" stays a real,
 * specific number even on Free; only the *who* is withheld, and shown as a
 * blurred, generic preview (not fabricated real-looking data — the API
 * genuinely never sends viewer rows in count_only mode, so there is
 * nothing real to blur; the placeholder rows just illustrate the shape of
 * what Premium unlocks, sized to the real count).
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { LockedPreview } from './LockedPreview';
import { EmptyState } from './ui';

interface Viewer {
  viewedAt: string;
  source: 'DETAIL_VIEW' | 'SHORTLIST' | 'REJECT' | 'MESSAGE' | 'STATUS_CHANGE';
  orgName: string | null;
}
type ViewersResponse =
  | { tier: string; mode: 'count_only'; count: number }
  | { tier: string; mode: 'full'; viewers: Viewer[] };

const SOURCE_LABEL: Record<Viewer['source'], string> = {
  DETAIL_VIEW: 'Viewed your profile',
  SHORTLIST: 'Shortlisted you',
  REJECT: 'Reviewed your application',
  STATUS_CHANGE: 'Updated your application status',
  MESSAGE: 'Messaged you',
};

const MAX_PLACEHOLDER_ROWS = 4;

export default function ProfileViewersPanel() {
  const [data, setData] = useState<ViewersResponse | null>(null);

  useEffect(() => {
    api<ViewersResponse>('/profiles/me/viewers').then(setData).catch(() => undefined);
  }, []);

  if (!data) return null;

  const count = data.mode === 'full' ? data.viewers.length : data.count;
  const teaser =
    count === 0
      ? 'No employers have viewed your profile yet.'
      : `${count} employer${count === 1 ? ' has' : 's have'} viewed your profile.`;

  return (
    <section className="ui-card profile-panel">
      <h2>Profile viewers</h2>
      <p>
        See which employers looked at your profile, shortlisted you, or reviewed your applications —
        recorded from the moment it happens, regardless of your plan.
      </p>

      {data.mode === 'count_only' &&
        (count === 0 ? (
          <EmptyState message={teaser} />
        ) : (
          <LockedPreview teaser={teaser}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: Math.min(count, MAX_PLACEHOLDER_ROWS) }).map((_, i) => (
                <div key={i} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                  <strong>Employer</strong>
                  <div className="meta">Viewed your profile</div>
                </div>
              ))}
            </div>
          </LockedPreview>
        ))}

      {data.mode === 'full' &&
        (data.viewers.length === 0 ? (
          <EmptyState message={teaser} />
        ) : (
          data.viewers.map((v, i) => (
            <div key={i} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <strong>{v.orgName ?? 'An employer'}</strong>
              <div className="meta">
                {SOURCE_LABEL[v.source] ?? v.source} · {new Date(v.viewedAt).toLocaleDateString()}
              </div>
            </div>
          ))
        ))}
    </section>
  );
}
