'use client';

/**
 * One hiring project (/employer/projects/[id]). Each role is a job: new roles
 * are made with the normal job form (/employer/jobs?new=1&project=<id>, which
 * links the saved job back here), existing jobs can be added, and every
 * role's hired / in-progress numbers come from its job's shortlist pipeline
 * (GET /projects/:id). Headcount and target start are edited in the table.
 *
 * A recruiter's project is for one client: its roles are agency postings for
 * that client, and progress counts the people submitted to the client for
 * each role (placed = hired). Applicants are submitted from the job's
 * applicant list, so each role links there and to Submissions.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { Badge, EmptyState } from '@/components/ui';
import HeadcountBar from './HeadcountBar';
import { dateRange } from './EmployerProjects';

const { api } = employerApi;

type JobStatus = 'DRAFT' | 'LIVE' | 'CLOSED';

interface ProjectRoleView {
  id: string;
  jobId: string;
  code: string;
  title: string;
  jobStatus: JobStatus;
  location: string | null;
  headcount: number;
  targetStartDate: string | null;
  hired: number;
  inProgress: number;
  filled: boolean;
  late: boolean;
  blockers: string[];
}

interface ProjectView {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  /** Recruiter projects: the client the work is for. */
  client?: { id: string; name: string } | null;
  recruiter?: boolean;
  roles: ProjectRoleView[];
  headcount: number;
  hired: number;
  inProgress: number;
  openRoles: number;
}

interface OrgJob {
  id: string;
  code: string;
  title: string;
  status: JobStatus;
  projectRole: { projectId: string } | null;
  postedForClient?: { id: string } | null;
}

const JOB_STATUS: Record<JobStatus, { label: string; variant: 'default' | 'verified' | 'neutral' }> = {
  DRAFT: { label: 'Draft', variant: 'default' },
  LIVE: { label: 'Posted', variant: 'verified' },
  CLOSED: { label: 'Closed', variant: 'neutral' },
};

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export default function EmployerProjectDetail({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [jobs, setJobs] = useState<OrgJob[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', startDate: '', endDate: '' });
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ jobId: '', headcount: '1', targetStartDate: '' });

  const load = useCallback(async () => {
    try {
      const [p, js] = await Promise.all([api<ProjectView>(`/projects/${projectId}`), api<OrgJob[]>('/jobs')]);
      setProject(p);
      setJobs(js);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await fn();
      await load();
      if (done) setNotice(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function startEdit() {
    if (!project) return;
    setForm({
      name: project.name,
      description: project.description ?? '',
      startDate: dateInput(project.startDate),
      endDate: dateInput(project.endDate),
    });
    setEditing(true);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    await run('edit', () =>
      api(`/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
        }),
      }),
    );
    setEditing(false);
  }

  const setStatus = (status: ProjectView['status'], done: string) =>
    run('status', () => api(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ status }) }), done);

  const updateRole = (roleId: string, body: Record<string, unknown>) =>
    run(`role-${roleId}`, () => api(`/projects/${projectId}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(body) }));

  async function addExisting(e: FormEvent) {
    e.preventDefault();
    await run(
      'add',
      () =>
        api(`/projects/${projectId}/roles`, {
          method: 'POST',
          body: JSON.stringify({
            jobId: addForm.jobId,
            headcount: Number(addForm.headcount),
            ...(addForm.targetStartDate ? { targetStartDate: addForm.targetStartDate } : {}),
          }),
        }),
      'Role added.',
    );
    setAdding(false);
    setAddForm({ jobId: '', headcount: '1', targetStartDate: '' });
  }

  async function postReady() {
    setBusy('publish');
    setError('');
    setNotice('');
    try {
      const res = await api<{ published: string[]; skipped: { id: string; reason: string }[] }>(`/projects/${projectId}/publish`, {
        method: 'POST',
      });
      await load();
      setNotice(
        `Posted ${res.published.length} role${res.published.length === 1 ? '' : 's'}` +
          (res.skipped.length ? `; ${res.skipped.length} still need changes.` : '.'),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!project) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="meta">Loading…</p>
    );
  }

  // A recruiter project only takes jobs posted for its client.
  const freeJobs = jobs.filter(
    (j) => !j.projectRole && j.status !== 'CLOSED' && (!project.client || j.postedForClient?.id === project.client.id),
  );
  const readyDrafts = project.roles.filter((r) => r.jobStatus === 'DRAFT' && !r.blockers.length).length;
  const archived = project.status === 'ARCHIVED';

  return (
    <div className="projects">
      <p className="meta" style={{ margin: 0 }}>
        <Link href="/employer/projects">← Projects</Link>
      </p>

      {editing ? (
        <form className="card projects-form" onSubmit={saveEdit}>
          <div className="field">
            <label htmlFor="pName">Name</label>
            <input id="pName" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pDesc">Description</label>
            <textarea id="pDesc" rows={2} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="projects-dates">
            <div className="field">
              <label htmlFor="pStart">Start date</label>
              <input id="pStart" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="pEnd">End date</label>
              <input id="pEnd" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div className="projects-form-actions">
            <button type="submit" disabled={busy === 'edit'}>
              {busy === 'edit' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <section className="card project-header">
          <div className="project-card-head">
            <h1 style={{ margin: 0 }}>{project.name}</h1>
            {project.status !== 'ACTIVE' && <Badge variant="neutral">{project.status === 'COMPLETED' ? 'Completed' : 'Archived'}</Badge>}
          </div>
          <div className="meta">
            {project.client ? `For ${project.client.name} · ` : ''}
            {dateRange(project.startDate, project.endDate)}
          </div>
          {project.description && <p style={{ margin: 0 }}>{project.description}</p>}
          <HeadcountBar headcount={project.headcount} hired={project.hired} inProgress={project.inProgress} />
          <div className="project-header-actions">
            <button type="button" className="btn-link" onClick={startEdit}>
              Edit details
            </button>
            {project.status === 'ACTIVE' && (
              <button
                type="button"
                className="btn-link"
                disabled={busy === 'status'}
                onClick={() =>
                  setStatus(
                    'COMPLETED',
                    project.openRoles
                      ? `Marked complete with ${project.openRoles} open role${project.openRoles === 1 ? '' : 's'}; their jobs are unchanged.`
                      : 'Marked complete.',
                  )
                }
              >
                Mark complete
              </button>
            )}
            {project.status === 'COMPLETED' && (
              <button type="button" className="btn-link" disabled={busy === 'status'} onClick={() => setStatus('ACTIVE', 'Reopened.')}>
                Reopen
              </button>
            )}
            {archived ? (
              <button type="button" className="btn-link" disabled={busy === 'status'} onClick={() => setStatus('ACTIVE', 'Restored.')}>
                Restore
              </button>
            ) : (
              <button type="button" className="btn-link" disabled={busy === 'status'} onClick={() => setStatus('ARCHIVED', 'Archived. Its jobs are unchanged.')}>
                Archive
              </button>
            )}
          </div>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ok" role="status">
          {notice}
        </p>
      )}

      <section className="card project-roles">
        <div className="project-roles-head">
          <h2>Roles</h2>
          {!archived && (
            <div className="project-roles-actions">
              <Link href={`/employer/jobs?new=1&project=${project.id}`} className="btn btn-primary">
                + New role
              </Link>
              <button type="button" className="btn btn-secondary" onClick={() => setAdding((v) => !v)}>
                Add an existing job
              </button>
            </div>
          )}
        </div>

        {adding && (
          <form className="project-add-role" onSubmit={addExisting}>
            <div className="field">
              <label htmlFor="addJob">Job</label>
              <select id="addJob" required value={addForm.jobId} onChange={(e) => setAddForm({ ...addForm, jobId: e.target.value })}>
                <option value="">Choose a job…</option>
                {freeJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} ({j.code}) · {JOB_STATUS[j.status].label}
                  </option>
                ))}
              </select>
              {freeJobs.length === 0 && (
                <p className="meta">
                  {project.client
                    ? `Every open job for ${project.client.name} is already in a project.`
                    : 'Every open job is already in a project.'}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="addHeadcount">People needed</label>
              <input id="addHeadcount" type="number" min={1} max={50} required value={addForm.headcount} onChange={(e) => setAddForm({ ...addForm, headcount: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="addStart">Target start (optional)</label>
              <input id="addStart" type="date" value={addForm.targetStartDate} onChange={(e) => setAddForm({ ...addForm, targetStartDate: e.target.value })} />
            </div>
            <button type="submit" disabled={!addForm.jobId || busy === 'add'}>
              {busy === 'add' ? 'Adding…' : 'Add role'}
            </button>
          </form>
        )}

        {project.roles.length === 0 ? (
          <EmptyState message="No roles yet. Add a new role, or an existing job." />
        ) : (
          <table className="job-import-table project-roles-table">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">People needed</th>
                <th scope="col">Target start</th>
                <th scope="col">Progress</th>
                <th scope="col">Job</th>
              </tr>
            </thead>
            <tbody>
              {project.roles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.title}</strong>
                    <div className="meta">
                      {r.code}
                      {r.location ? ` · ${r.location}` : ''}
                    </div>
                  </td>
                  <td data-label="People needed">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      aria-label={`People needed for ${r.title}`}
                      defaultValue={r.headcount}
                      disabled={archived || busy === `role-${r.id}`}
                      className="project-headcount-input"
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (n >= 1 && n <= 50 && n !== r.headcount) void updateRole(r.id, { headcount: n });
                      }}
                    />
                  </td>
                  <td data-label="Target start">
                    <input
                      type="date"
                      aria-label={`Target start for ${r.title}`}
                      defaultValue={dateInput(r.targetStartDate)}
                      disabled={archived || busy === `role-${r.id}`}
                      onBlur={(e) => {
                        if (e.target.value !== dateInput(r.targetStartDate)) void updateRole(r.id, { targetStartDate: e.target.value || null });
                      }}
                    />
                    {r.late && <div className="job-import-problem">Start date passed</div>}
                  </td>
                  <td>
                    <HeadcountBar headcount={r.headcount} hired={r.hired} inProgress={r.inProgress} compact />
                    {r.filled && <Badge variant="verified">Filled</Badge>}
                  </td>
                  <td>
                    <Badge variant={JOB_STATUS[r.jobStatus].variant}>{JOB_STATUS[r.jobStatus].label}</Badge>
                    {r.blockers.map((b) => (
                      <div key={b} className="job-import-problem">
                        {b}
                      </div>
                    ))}
                    <div className="project-role-links">
                      {r.jobStatus === 'DRAFT' ? (
                        <Link href={`/employer/jobs?edit=${r.jobId}`} className="btn-link">
                          Open draft
                        </Link>
                      ) : project.recruiter ? (
                        <>
                          <Link href={`/employer/jobs?openApplicants=${r.jobId}`} className="btn-link">
                            Applicants
                          </Link>
                          <Link href="/employer/submissions" className="btn-link">
                            Submissions
                          </Link>
                        </>
                      ) : (
                        <Link href={`/employer/shortlist?jobId=${r.jobId}`} className="btn-link">
                          View pipeline
                        </Link>
                      )}
                      {r.filled && r.jobStatus === 'LIVE' && (
                        <button
                          type="button"
                          className="btn-link"
                          disabled={busy === `close-${r.id}`}
                          onClick={() =>
                            run(
                              `close-${r.id}`,
                              () => api(`/jobs/${r.jobId}`, { method: 'PATCH', body: JSON.stringify({ status: 'CLOSED' }) }),
                              `${r.title} is filled and its job is now closed.`,
                            )
                          }
                        >
                          Close job
                        </button>
                      )}
                      {!archived && (
                        <button
                          type="button"
                          className="btn-link"
                          disabled={busy === `remove-${r.id}`}
                          onClick={() =>
                            run(`remove-${r.id}`, () => api(`/projects/${projectId}/roles/${r.id}`, { method: 'DELETE' }), `${r.title} removed from the project; its job is unchanged.`)
                          }
                        >
                          Remove from project
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {readyDrafts > 0 && !archived && (
          <div className="job-import-actions">
            <button type="button" onClick={postReady} disabled={busy === 'publish'}>
              {busy === 'publish' ? 'Posting…' : `Post ready roles (${readyDrafts})`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
