'use client';

/**
 * Bulk job import (Job Postings → Import from file). Upload a CSV made from
 * the template; every valid row becomes a DRAFT job (POST /jobs/import),
 * rows with problems are skipped and listed with the reason. The drafts
 * from that upload are then reviewed here: each shows what still blocks
 * posting (no required skill, no city and not remote), the ready ones can be
 * posted together (POST /jobs/import/publish), and any draft opens in the
 * normal job form to fix (/employer/jobs?edit=<id>).
 *
 * The batch id lives in the URL (?batch=), so the review survives going to
 * the edit form and back. The upload-time notes (AI-suggested skills, city
 * matches) are shown only right after the upload.
 */
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { employerApi, downloadBlob, type ApiError } from '@/lib/api';
import { Badge } from '@/components/ui';
import { skillLevelName } from '@/lib/skillLevels';

const { api, apiBlob } = employerApi;

interface ImportRowResult {
  row: number;
  title: string;
  code: string | null;
  status: 'created' | 'skipped';
  jobId?: string;
  errors: string[];
  warnings: string[];
  blockers: string[];
}

interface ImportResult {
  batchId: string | null;
  created: number;
  skipped: number;
  rows: ImportRowResult[];
}

interface BatchJob {
  id: string;
  code: string;
  title: string;
  status: 'DRAFT' | 'LIVE' | 'CLOSED';
  location: string | null;
  remote: boolean;
  skills: { name: string; level: string; isRequired: boolean }[];
  blockers: string[];
}

interface PublishResult {
  published: string[];
  skipped: { id: string; reason: string }[];
}

export default function EmployerJobImport() {
  const router = useRouter();
  const batchId = useSearchParams().get('batch');

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [jobs, setJobs] = useState<BatchJob[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [error, setError] = useState('');

  const loadBatch = useCallback(async (id: string) => {
    try {
      const list = await api<BatchJob[]>(`/jobs/import/${id}`);
      setJobs(list);
      setSelected(new Set(list.filter((j) => j.status === 'DRAFT' && !j.blockers.length).map((j) => j.id)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (batchId) void loadBatch(batchId);
    else setJobs(null);
  }, [batchId, loadBatch]);

  async function downloadTemplate() {
    try {
      downloadBlob(await apiBlob('/jobs/import/template'), 'myambii-jobs-template.csv');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setError('');
    setPublished(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api<ImportResult>('/jobs/import', { method: 'POST', body });
      setResult(res);
      setFile(null);
      if (res.batchId) router.replace(`/employer/jobs/import?batch=${res.batchId}`);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setUploading(false);
    }
  }

  async function publishSelected() {
    if (!batchId || selected.size === 0) return;
    setPublishing(true);
    setError('');
    try {
      const res = await api<PublishResult>('/jobs/import/publish', {
        method: 'POST',
        body: JSON.stringify({ jobIds: Array.from(selected) }),
      });
      setPublished(res);
      await loadBatch(batchId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const notesByJob = new Map((result?.rows ?? []).filter((r) => r.jobId).map((r) => [r.jobId!, r.warnings]));
  const skippedRows = (result?.rows ?? []).filter((r) => r.status === 'skipped');
  const readyCount = (jobs ?? []).filter((j) => j.status === 'DRAFT' && !j.blockers.length).length;

  return (
    <div className="job-import">
      <p className="meta" style={{ marginTop: 0 }}>
        <Link href="/employer/jobs">← Job Postings</Link>
      </p>

      <section className="card job-import-step">
        <h2>1. Fill in the template</h2>
        <p>
          One job per row, up to 50 per file. Only <strong>title</strong>, <strong>description</strong> and{' '}
          <strong>employment type</strong> are required. Leave <strong>skills</strong> empty and we&rsquo;ll suggest
          them from the description. Salary is in lakhs per year (LPA).
        </p>
        <p className="meta">
          Skills look like <code>RAG Systems: L2; Prompt Engineering: L1 (optional)</code>. Levels can be L1–L4 or
          Foundational, Practitioner, Advanced, Expert.
        </p>
        <button type="button" className="btn btn-secondary" onClick={downloadTemplate}>
          Download template (CSV)
        </button>
      </section>

      <section className="card job-import-step">
        <h2>2. Upload it</h2>
        <p>
          In Excel or Google Sheets, save as <strong>CSV UTF-8</strong>. Every valid row becomes a draft; nothing is
          posted until you choose to.
        </p>
        <div className="job-import-upload">
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)}
          />
          <button type="button" onClick={upload} disabled={!file || uploading}>
            {uploading ? 'Importing… (AI may take a minute)' : 'Import jobs'}
          </button>
        </div>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <p className="job-import-summary" role="status">
          {result.created} draft{result.created === 1 ? '' : 's'} created
          {result.skipped > 0 ? `, ${result.skipped} row${result.skipped === 1 ? '' : 's'} skipped` : ''}.
        </p>
      )}

      {skippedRows.length > 0 && (
        <section className="card job-import-step">
          <h2>Rows not imported</h2>
          <p className="meta">Fix these in your file and upload just those rows again.</p>
          <table className="job-import-table">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Title</th>
                <th scope="col">Problem</th>
              </tr>
            </thead>
            <tbody>
              {skippedRows.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td>{r.title || '(no title)'}</td>
                  <td className="job-import-problem">{r.errors.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {jobs && (
        <section className="card job-import-step">
          <h2>3. Review and post</h2>
          {jobs.length === 0 ? (
            <p className="meta">No drafts in this upload.</p>
          ) : (
            <>
              <p className="meta">
                {readyCount} of {jobs.filter((j) => j.status === 'DRAFT').length} drafts are ready to post. Open a draft
                to check AI-suggested skills or fix what&rsquo;s missing.
              </p>
              <table className="job-import-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Select</span>
                    </th>
                    <th scope="col">Job</th>
                    <th scope="col">Location</th>
                    <th scope="col">Skills</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const ready = j.status === 'DRAFT' && !j.blockers.length;
                    const notes = notesByJob.get(j.id) ?? [];
                    return (
                      <tr key={j.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${j.title}`}
                            checked={selected.has(j.id)}
                            disabled={!ready}
                            onChange={() => toggle(j.id)}
                          />
                        </td>
                        <td>
                          <strong>{j.title}</strong>
                          <div className="meta">{j.code}</div>
                        </td>
                        <td>{j.location ?? (j.remote ? 'Remote' : '—')}</td>
                        <td>
                          {j.skills.length
                            ? j.skills
                                .map((s) => `${s.name} (${skillLevelName(s.level)}${s.isRequired ? '' : ', optional'})`)
                                .join(', ')
                            : '—'}
                        </td>
                        <td>
                          {j.status === 'LIVE' && <Badge variant="verified">Posted</Badge>}
                          {j.status === 'CLOSED' && <Badge variant="neutral">Closed</Badge>}
                          {j.status === 'DRAFT' && (
                            <>
                              {ready ? <Badge variant="default">Ready</Badge> : <Badge variant="warning">Needs changes</Badge>}
                              {j.blockers.map((b) => (
                                <div key={b} className="job-import-problem">
                                  {b}
                                </div>
                              ))}
                              {notes.map((n) => (
                                <div key={n} className="meta">
                                  {n}
                                </div>
                              ))}
                              <Link href={`/employer/jobs?edit=${j.id}`} className="btn-link">
                                Open draft
                              </Link>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="job-import-actions">
                <button type="button" onClick={publishSelected} disabled={publishing || selected.size === 0}>
                  {publishing ? 'Posting…' : `Post selected (${selected.size})`}
                </button>
              </div>
              {published && (
                <p className="job-import-summary" role="status">
                  Posted {published.published.length} job{published.published.length === 1 ? '' : 's'}
                  {published.skipped.length
                    ? `; ${published.skipped.length} not posted: ${published.skipped.map((s) => s.reason).join(' ')}`
                    : '.'}
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
