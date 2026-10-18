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
  verifiedBy: 'TEST' | 'DISCUSSION';
  issuedAt: string;
  expiresAt: string;
  valid: boolean;
  /**
   * A positive-only trust signal from the server — true only while the
   * attempt is CLEAN. There's no corresponding "flagged" field: if this is
   * false, we render nothing about integrity at all, never a negative label.
   */
  verifiedClean: boolean;
  /**
   * 'inactive' covers both a reversible deactivation and a permanent
   * deletion — the server deliberately never says which (see
   * AssessmentsService.verifyBadge's own doc comment): an employer
   * verifying a certificate only needs to know the candidate isn't
   * currently active, never why. The badge itself is never revoked or
   * hidden for either reason, so everything else on this page still
   * renders normally — this only adds one extra, honest line.
   */
  accountStatus: 'active' | 'inactive';
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

  // An expired badge is never hidden or 404'd (see AssessmentsService.verifyBadge —
  // only a missing/revoked badge 404s). It's shown honestly: genuinely earned
  // and verified, but since lapsed. The whole cert shifts from the green
  // "valid" chrome to a muted amber "expired" treatment so it can't be mistaken
  // for a currently-valid credential at a glance, while the ✓ mark and the
  // issued date preserve the fact that it *was* earned and verified.
  const expired = !badge.valid;

  return (
    <>
      <PublicNav />
      <main>
        <div className={`cert${expired ? ' cert-expired' : ''}`}>
          <div className={`cert-mark${expired ? ' cert-mark-expired' : ''}`}>✓</div>
          <h1>{expired ? 'Expired Credential' : 'Verified Skill'}</h1>
          <p className="cert-skill">{badge.skill} — Level {badge.level}</p>
          <p><strong>{badge.candidate}</strong></p>
          <p className="meta">
            {badge.verifiedBy === 'DISCUSSION' ? 'Verified by technical discussion' : 'Verified by written assessment'}
          </p>
          {badge.verifiedClean && (
            <p style={{ margin: '0 0 16px' }}>
              <Badge variant="verified">✓ Verified clean</Badge>
            </p>
          )}
          <p className="meta">
            {expired ? (
              <>
                Issued {new Date(badge.issuedAt).toLocaleDateString()} · Expired{' '}
                {new Date(badge.expiresAt).toLocaleDateString()}
              </>
            ) : (
              <>
                Issued {new Date(badge.issuedAt).toLocaleDateString()} · Valid until{' '}
                {new Date(badge.expiresAt).toLocaleDateString()}
              </>
            )}
          </p>
          <p className={expired ? 'cert-status-expired' : 'ok'}>
            {expired ? 'This certificate has expired.' : 'This certificate is valid.'}
          </p>
          {expired && (
            <p className="meta">
              This credential was genuinely earned and verified on{' '}
              {new Date(badge.issuedAt).toLocaleDateString()}. It has since lapsed and is no longer current — the
              candidate can retake the assessment to renew it.
            </p>
          )}
          {badge.accountStatus === 'inactive' && (
            <p className="meta">
<<<<<<< Updated upstream
              This candidate is not currently active on MyAmbii. The credential itself was genuinely earned and
              remains valid.
=======
              This candidate is not currently active on SkillProof. The credential itself was genuinely earned{' '}
              {expired ? 'and has since expired.' : 'and remains valid.'}
>>>>>>> Stashed changes
            </p>
          )}
          <p className="meta">Verification ID: {hash}</p>
        </div>
      </main>
    </>
  );
}
