'use client';

/**
 * Projects list (employer sidebar → Projects). A project groups the roles one
 * piece of work needs; each card shows hired against headcount, counted by
 * the API from each role's job pipeline (GET /projects). "New project" is an
 * inline form; a project's roles are managed on its own page.
 */
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import { Badge, EmptyState } from '@/components/ui';
import HeadcountBar from './HeadcountBar';

const { api } = employerApi;

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  roleCount: number;
  headcount: number;
  hired: number;
  inProgress: number;
  openRoles: number;
  lateRoles: number;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function dateRange(start: string | null, end: string | null): string {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return `From ${formatDate(start)}`;
  if (end) return `Until ${formatDate(end)}`;
  return 'No dates set';
}

export default function EmployerProjects() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', startDate: '', endDate: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    api<ProjectSummary[]>(`/projects${showArchived ? '?archived=1' : ''}`)
      .then(setProjects)
      .catch((e) => setError((e as Error).message));
  }, [showArchived]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const p = await api<{ id: string }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          ...(form.startDate ? { startDate: form.startDate } : {}),
          ...(form.endDate ? { endDate: form.endDate } : {}),
        }),
      });
      router.push(`/employer/projects/${p.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="projects">
      <div className="projects-toolbar">
        <p className="meta" style={{ margin: 0 }}>
          Group the roles one piece of work needs, and see how many are hired.
        </p>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}>
            + New project
          </button>
        )}
      </div>

      {creating && (
        <form className="card projects-form" onSubmit={create}>
          <h2>New project</h2>
          <div className="field">
            <label htmlFor="projectName">Name</label>
            <input
              id="projectName"
              required
              minLength={2}
              maxLength={120}
              value={form.name}
              placeholder="e.g. Support AI rollout"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="projectDescription">Description (optional)</label>
            <textarea
              id="projectDescription"
              rows={2}
              maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="projects-dates">
            <div className="field">
              <label htmlFor="projectStart">Start date (optional)</label>
              <input id="projectStart" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="projectEnd">End date (optional)</label>
              <input id="projectEnd" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div className="projects-form-actions">
            <button type="submit" disabled={saving || form.name.trim().length < 2}>
              {saving ? 'Creating…' : 'Create project'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setCreating(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {projects && projects.length === 0 && !creating && (
        <EmptyState message="No projects yet. Create one to track the roles a piece of work needs." />
      )}

      <div className="projects-grid">
        {(projects ?? []).map((p) => (
          <Link key={p.id} href={`/employer/projects/${p.id}`} className="card project-card">
            <div className="project-card-head">
              <strong>{p.name}</strong>
              {p.status !== 'ACTIVE' && <Badge variant="neutral">{p.status === 'COMPLETED' ? 'Completed' : 'Archived'}</Badge>}
            </div>
            <div className="meta">{dateRange(p.startDate, p.endDate)}</div>
            <HeadcountBar headcount={p.headcount} hired={p.hired} inProgress={p.inProgress} />
            <div className="project-card-foot">
              <span>
                {p.roleCount} role{p.roleCount === 1 ? '' : 's'} · {p.openRoles} open
              </span>
              {p.lateRoles > 0 && <Badge variant="warning">{p.lateRoles} past start date</Badge>}
            </div>
          </Link>
        ))}
      </div>

      <label className="projects-archived-toggle">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Show archived projects
      </label>
    </div>
  );
}
