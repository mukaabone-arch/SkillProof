'use client';

/**
 * Org-wide "Applicants" section — every application across every job this
 * org owns, most recent first. Backed by GET /jobs/applicants
 * (JobsService.getApplicantsForOrg), which is the same enrichment as the
 * per-job applicants list in EmployerJobs, just without a single job's
 * score (score is fit against one job's requirements — meaningless across
 * a list spanning many jobs, so it's always null here; see that endpoint's
 * doc comment). Reuses ApplicantCard rather than re-building the applicant
 * markup a third time.
 */
import { useEffect, useState } from 'react';
import { employerApi, downloadBlob } from '@/lib/api';
import { EmptyState } from '@/components/ui';
import ShortlistButton from './ShortlistButton';
import ApplicantCard, { type ApplicantCardData } from './ApplicantCard';

const { api, apiBlob } = employerApi;

type Applicant = ApplicantCardData & { jobId: string; jobTitle: string };

interface ShortlistEntrySummary {
  id: string;
  candidateId: string;
  job: { id: string; title: string } | null;
}

const STATUS_ACTIONS = ['REVIEWED', 'SHORTLISTED', 'REJECTED'];

/** Keys a shortlist lookup by (jobId, candidateId) — a candidate can be shortlisted separately for several of the org's jobs. */
function shortlistKey(jobId: string | null, candidateId: string) {
  return `${jobId ?? ''}:${candidateId}`;
}

export default function EmployerApplicants() {
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [shortlist, setShortlist] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [statusConfirmed, setStatusConfirmed] = useState<string | null>(null);
  const [resumeDownloadingId, setResumeDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [applicantsRes, shortlistRes] = await Promise.all([
        api<Applicant[]>('/jobs/applicants'),
        api<ShortlistEntrySummary[]>('/shortlist'),
      ]);
      setApplicants(applicantsRes);
      const map: Record<string, string> = {};
      shortlistRes.forEach((e) => { map[shortlistKey(e.job?.id ?? null, e.candidateId)] = e.id; });
      setShortlist(map);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function viewResume(jobId: string, profileId: string) {
    setResumeDownloadingId(profileId);
    setError('');
    try {
      const blob = await apiBlob(`/jobs/${jobId}/applicants/${profileId}/resume`);
      downloadBlob(blob, 'resume.pdf');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResumeDownloadingId(null);
    }
  }

  async function updateStatus(applicationId: string, status: string) {
    setStatusUpdating(applicationId);
    setError('');
    try {
      const updated = await api<{ status: string }>(`/applications/${applicationId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setApplicants((prev) => prev.map((a) => (a.applicationId === applicationId ? { ...a, status: updated.status } : a)));
      setStatusConfirmed(applicationId);
      setTimeout(() => setStatusConfirmed((c) => (c === applicationId ? null : c)), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStatusUpdating(null);
    }
  }

  return (
    <main className="container-wide">
      <h1>Applicants</h1>
      <p>Every applicant across all your job postings, most recent first.</p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="meta">Loading…</p>}

      {!loading && applicants.length === 0 && (
        <EmptyState message="No applicants yet — candidates will appear here once they apply." />
      )}

      {!loading && applicants.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {applicants.map((a) => {
            const key = shortlistKey(a.jobId, a.profileId);
            return (
              <ApplicantCard
                key={a.applicationId}
                applicant={a}
                headerActions={
                  <ShortlistButton
                    candidateId={a.profileId}
                    jobId={a.jobId}
                    entryId={shortlist[key] ?? null}
                    onAdded={(entryId) => setShortlist((prev) => ({ ...prev, [key]: entryId }))}
                    onRemoved={() => setShortlist((prev) => {
                      const next = { ...prev };
                      delete next[key];
                      return next;
                    })}
                    onError={setError}
                  />
                }
                resumeAction={
                  a.hasResume ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => viewResume(a.jobId, a.profileId)}
                      disabled={resumeDownloadingId === a.profileId}
                    >
                      {resumeDownloadingId === a.profileId ? 'Downloading…' : 'View resume'}
                    </button>
                  ) : undefined
                }
                footer={
                  <>
                    <p className="meta" style={{ margin: 0 }}>Applied for {a.jobTitle}</p>
                    <div className="row" style={{ alignItems: 'center', margin: 0 }}>
                      <span className="meta" style={{ margin: 0 }}>Status: {a.status}</span>
                      {STATUS_ACTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => updateStatus(a.applicationId, s)}
                          disabled={statusUpdating === a.applicationId || a.status === s}
                        >
                          {s}
                        </button>
                      ))}
                      {statusConfirmed === a.applicationId && (
                        <span className="ok" style={{ margin: 0 }}>✓ Updated</span>
                      )}
                    </div>
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </main>
  );
}
