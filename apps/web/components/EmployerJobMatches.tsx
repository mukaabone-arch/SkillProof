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
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { matchBand, MATCH_BAND_LABELS, MATCH_BAND_VARIANTS } from '@/lib/matchBand';

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

const FUNNEL_TILES: { key: keyof MatchFunnel; label: string }[] = [
  { key: 'considered', label: 'Considered' },
  { key: 'relevant', label: 'Relevant' },
  { key: 'verifiedMatch', label: 'Verified match' },
  { key: 'strongMatch', label: 'Strong match' },
];

interface Props {
  jobId: string;
}

export default function EmployerJobMatches({ jobId }: Props) {
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
        <h1>Talent match</h1>
        <LoadingState message="Scoring candidates…" />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <h1>Talent match</h1>
        <ErrorState message={error || 'Could not load matches.'} onRetry={load} />
      </>
    );
  }

  const { funnel, unmatchedRequiredSkills, allCandidates } = data;
  const maxCount = Math.max(funnel.considered, 1);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', margin: 0 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>Talent match</h1>
          <p className="meta" style={{ margin: 0 }}>{data.jobTitle}</p>
        </div>
        <Link href="/employer/jobs" className="btn btn-secondary">Back to Job Postings</Link>
      </div>

      <div
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginTop: 24, marginBottom: 24 }}
      >
        {FUNNEL_TILES.map((tile) => {
          const count = funnel[tile.key];
          return (
            <div key={tile.key} className="status-card">
              <div className="status-card-label">{tile.label}</div>
              <div className="status-stat">{count}</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(count / (maxCount || 1)) * 100}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {funnel.considered === 0 ? (
        <EmptyState message="No candidates match this job yet.">
          {unmatchedRequiredSkills.length > 0 && (
            <p className="meta" style={{ marginTop: 8 }}>
              These required skills currently have no verified candidates on the platform:{' '}
              {unmatchedRequiredSkills.map((s) => s.skillName).join(', ')}. That&apos;s the most direct lever here —
              broadening the required level, marking a skill optional, or waiting for candidates to earn that badge
              will all change this number.
            </p>
          )}
        </EmptyState>
      ) : (
        <>
          <h2 style={{ marginTop: 32, marginBottom: 12 }}>Candidates</h2>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Match</th>
                  <th>Verified skills</th>
                  <th>Experience</th>
                </tr>
              </thead>
              <tbody>
                {allCandidates.map((c) => {
                  const band = matchBand(c.score);
                  return (
                    <tr key={c.profileId}>
                      <td>{c.fullName || 'Candidate'}</td>
                      <td>
                        <Badge variant={MATCH_BAND_VARIANTS[band]}>{MATCH_BAND_LABELS[band]}</Badge>
                      </td>
                      <td>{c.verifiedSkillCount}</td>
                      <td>
                        {c.yearsOfExp !== null ? `${c.yearsOfExp} yrs (self-reported)` : 'Not shared'}
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
