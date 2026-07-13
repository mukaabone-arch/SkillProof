'use client';

/** Public certificate page: GET /badges/verify/:hash (no auth needed).
 *  This is the URL candidates share on LinkedIn. */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui';
import PublicNav from '@/components/PublicNav';

interface BadgeInfo {
  candidate: string;
  skill: string;
  level: string;
  issuedAt: string;
  expiresAt: string;
  valid: boolean;
  /**
   * A positive-only trust signal from the server — true only while the
   * attempt is CLEAN. There's no corresponding "flagged" field: if this is
   * false, we render nothing about integrity at all, never a negative label.
   */
  verifiedClean: boolean;
}

export default function BadgeVerifyPage() {
  const { hash } = useParams<{ hash: string }>();
  const [badge, setBadge] = useState<BadgeInfo>();
  const [error, setError] = useState('');

  useEffect(() => {
    api<BadgeInfo>(`/badges/verify/${hash}`).then(setBadge).catch((e) => setError(e.message));
  }, [hash]);

  if (error) {
    return (
      <>
        <PublicNav />
        <main><h1>Badge not found</h1><p className="error">{error}</p></main>
      </>
    );
  }
  if (!badge) {
    return (
      <>
        <PublicNav />
        <main><p>Verifying…</p></main>
      </>
    );
  }

  return (
    <>
      <PublicNav />
      <main>
        <div className="cert">
          <div className="cert-mark">✓</div>
          <h1>Verified Skill</h1>
          <p className="cert-skill">{badge.skill} — Level {badge.level}</p>
          <p><strong>{badge.candidate}</strong></p>
          {badge.verifiedClean && (
            <p style={{ margin: '0 0 16px' }}>
              <Badge variant="verified">✓ Verified clean</Badge>
            </p>
          )}
          <p className="meta">
            Issued {new Date(badge.issuedAt).toLocaleDateString()} · Valid until{' '}
            {new Date(badge.expiresAt).toLocaleDateString()}
          </p>
          <p className={badge.valid ? 'ok' : 'error'}>
            {badge.valid ? 'This certificate is valid.' : 'This certificate has expired.'}
          </p>
          <p className="meta">Verification ID: {hash}</p>
        </div>
      </main>
    </>
  );
}
