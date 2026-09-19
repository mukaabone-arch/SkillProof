'use client';

/**
 * Employer-facing portfolio view — reachable only from the applicant/
 * shortlist views an org already has (never a browsable directory, see
 * EmployerCandidateAccessService.employerCanViewPortfolio). Renders the
 * exact same PortfolioSections component the candidate's own preview
 * uses, fed from GET /portfolio/candidates/:id instead of /portfolio/me.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';
import PortfolioSections from './PortfolioSections';
import { ErrorState, LoadingState } from '@/components/ui';
import type { PortfolioViewData } from '@/lib/portfolioTypes';

const { api } = employerApi;

interface Props {
  candidateId: string;
}

export default function EmployerPortfolioView({ candidateId }: Props) {
  const [data, setData] = useState<PortfolioViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api<PortfolioViewData>(`/portfolio/candidates/${candidateId}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  if (loading) return <LoadingState message="Loading portfolio…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  // Portfolio content is unverified/self-reported — see CandidatePortfolio's
  // doc comment in schema.prisma — so that distinction is repeated here,
  // not just implied by which chips are which color.
  return (
    <div>
      <p className="meta" style={{ marginBottom: 16 }}>
        Everything below except the green "Verified on MyAmbii" badges is self-reported by the
        candidate, taken from their resume — treat it the same way you'd treat a resume.
      </p>
      <PortfolioSections data={data} contactGated={!data.contact} />
    </div>
  );
}
