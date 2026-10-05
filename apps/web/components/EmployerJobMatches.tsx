'use client';

/**
 * Job-to-Talent Match: the funnel summary + ranked candidate table an
 * employer sees right after posting a job (and again from each job's row
 * in Job Postings, since matches change as candidates earn badges).
 *
 * Every number here is `allCandidates.length`-shaped — a count of rows GET
 * /jobs/:id/matches actually returned (MatchingService.getMatches), never
 * padded or estimated. At current supply that number is small on purpose;
 * see the zero/low-count branches below, which are the primary design here,
 * not edge cases bolted onto a "327 candidates discovered" layout.
 *
 * Bands, not raw scores — same call CandidateJobs.tsx's JobScoreBand
 * already made for the candidate-facing job cards ("no progress bar here:
 * that would just reintroduce the precision the band exists to remove").
 * An employer told "63%" about a candidate the platform told "Good match"
 * is two vocabularies for one number; this page uses the same
 * lib/matchBand.ts the candidate side uses, not apps/api's separate
 * numeric scoreBand (that one's a ranking tiebreak, not a display concern).
 */
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { employerApi } from '@/lib/api';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { matchBand, MATCH_BAND_VARIANTS } from '@/lib/matchBand';

const { api } = employerApi;

interface MatchFunnel {
  considered: number;
  relevant: number;
  verifiedMatch: number;
  strongMatch: number;
}

interface UnmatchedSkill {
  skillId: string;
  skillName: string;
}

interface CandidateSummary {
  profileId: string;
  fullName: string | null;
  score: number;
  verifiedSkillCount: number;
  yearsOfExp: number | null;
}

interface MatchesResponse {
  jobId: string;
  jobTitle: string;
  funnel: MatchFunnel;
  unmatchedRequiredSkills: UnmatchedSkill[];
  allCandidates: CandidateSummary[];
}

const FUNNEL_TILES: { key: keyof MatchFunnel; labelKey: string }[] = [
  { key: 'considered', labelKey: 'considered' },
  { key: 'relevant', labelKey: 'relevant' },
  { key: 'verifiedMatch', labelKey: 'verifiedMatch' },
  { key: 'strongMatch', labelKey: 'strongMatch' },
];

interface Props {
  jobId: string;
}

export default function EmployerJobMatches({ jobId }: Props) {
  const t = useTranslations('employerMatches');
  const locale = useLocale();
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    api<MatchesResponse>(`/jobs/${jobId}/matches`)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [jobId]);

  if (loading) {
    return (
      <>
        <h1>{t('title')}</h1>
        <LoadingState message={t('scoring')} />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <h1>{t('title')}</h1>
        <ErrorState message={error || t('loadError')} onRetry={load} />
      </>
    );
  }

  const { funnel, unmatchedRequiredSkills, allCandidates } = data;
  const maxCount = Math.max(funnel.considered, 1);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', margin: 0 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{t('title')}</h1>
          <p className="meta" style={{ margin: 0 }}>{data.jobTitle}</p>
        </div>
        {/* Job Postings is not localised yet; under Arabic this link would leave the session for English. */}
        {locale !== 'ar' && (
          <Link href="/employer/jobs" className="btn btn-secondary">{t('backToJobs')}</Link>
        )}
      </div>

      <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginTop: 24, marginBottom: 24 }}
      >
        {FUNNEL_TILES.map((tile) => {
          const count = funnel[tile.key];
          return (
            <div key={tile.key} className="status-card">
              <div className="status-card-label">{t(`funnel.${tile.labelKey}`)}</div>
              <div className="status-stat">{count}</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(count / (maxCount || 1)) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {funnel.considered === 0 ? (
        <EmptyState message={t('noMatches')}>
          {unmatchedRequiredSkills.length > 0 && (
            <p className="meta" style={{ marginTop: 8 }}>
              {t('unmatched', { skills: unmatchedRequiredSkills.map((s) => s.skillName).join(', ') })}
            </p>
          )}
        </EmptyState>
      ) : (
        <>
          <h2 style={{ marginTop: 32, marginBottom: 12 }}>{t('candidates')}</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('candidate')}</th>
                  <th>{t('columns.match')}</th>
                  <th>{t('columns.verifiedSkills')}</th>
                  <th>{t('columns.experience')}</th>
                </tr>
              </thead>
              <tbody>
                {allCandidates.map((c) => {
                  const band = matchBand(c.score);
                  return (
                    <tr key={c.profileId}>
                      <td>{c.fullName || t('candidate')}</td>
                      <td>
                        <Badge variant={MATCH_BAND_VARIANTS[band]}>{t(`bands.${band}`)}</Badge>
                      </td>
                      <td>{c.verifiedSkillCount}</td>
                      <td>
                        {c.yearsOfExp !== null ? t('experienceYears', { years: c.yearsOfExp }) : t('experienceNotShared')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
