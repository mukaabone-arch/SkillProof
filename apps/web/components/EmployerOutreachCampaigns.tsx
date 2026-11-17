'use client';

/**
 * AI sourcing (employer and recruiter sidebar). One campaign per live job:
 * the AI ranks every candidate who allows contact against the job's skills
 * and drafts a personal message for each; nothing is sent until the
 * recruiter approves it on the campaign page.
 */
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { CAMPAIGN_STATUS_LABEL, CampaignDetail, CampaignSummary, formatShortDate } from '@/lib/outreach';

const { api } = employerApi;

interface JobOption {
  id: string;
  title: string;
  code: string;
  status: string;
  skills: unknown[];
}

export default function EmployerOutreachCampaigns() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  function load() {
    setError('');
    api<CampaignSummary[]>('/outreach/campaigns')
      .then(setCampaigns)
      .catch((e) => setError((e as Error).message));
  }

  useEffect(() => {
    load();
    api<JobOption[]>('/jobs')
      .then((list) => setJobs(list.filter((j) => j.status === 'LIVE')))
      .catch(() => setJobs([]));
  }, []);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!jobId) return;
    setCreating(true);
    setError('');
    try {
      const c = await api<CampaignDetail>('/outreach/campaigns', { method: 'POST', body: JSON.stringify({ jobId }) });
      router.push(`/employer/outreach/${c.id}`);
    } catch (err) {
      setError((err as Error).message);
      setCreating(false);
    }
  }

  const openJobIds = new Set((campaigns ?? []).filter((c) => c.status !== 'CLOSED').map((c) => c.job.id));

  return (
    <>
      <p className="meta" style={{ marginTop: 0 }}>
        Pick a live job. The AI finds candidates whose verified skills match it, writes each one a personal message, and
        you approve before anything is sent. Candidates reply with one tap; follow-ups go out automatically after 3 and 7 days.
      </p>

      <form className="card outreach-start" onSubmit={start}>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
          <label htmlFor="outreach-job">Find candidates for</label>
          <select id="outreach-job" value={jobId} onChange={(e) => setJobId(e.target.value)} disabled={creating}>
            <option value="">Choose a live job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} ({j.code}){openJobIds.has(j.id) ? ' — campaign open' : ''}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={!jobId || creating}>
          {creating ? 'Finding candidates and writing messages…' : 'Find candidates with AI'}
        </button>
      </form>
      {jobs.length === 0 && campaigns && (
        <p className="meta">
          No live jobs yet. <Link href="/employer/jobs">Post a job</Link> first — AI sourcing matches on its skills.
        </p>
      )}
      {error && <ErrorState message={error} />}

      {!campaigns && !error && <LoadingState />}
      {campaigns && campaigns.length === 0 && <EmptyState message="No campaigns yet. Start one above." />}
      {campaigns && campaigns.length > 0 && (
        <div className="admin-table-wrap" style={{ marginTop: 16 }}>
          <table className="admin-table outreach-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Drafts</th>
                <th>Sent</th>
                <th>Interested</th>
                <th>Not now</th>
                <th>Declined</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/employer/outreach/${c.id}`}>{c.job.title}</Link>
                  </td>
                  <td>
                    <Badge variant={c.status === 'ACTIVE' ? 'default' : 'neutral'}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
                  </td>
                  <td>{c.counts.drafts}</td>
                  <td>{c.counts.sent}</td>
                  <td>
                    <strong>{c.counts.interested}</strong>
                  </td>
                  <td>{c.counts.notNow}</td>
                  <td>{c.counts.notInterested}</td>
                  <td>{formatShortDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
