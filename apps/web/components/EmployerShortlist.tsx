'use client';

/**
 * The org's shortlist — candidates collected from the applicants list, find-
 * candidates search, and match results (see ShortlistButton, used on all
 * three). SHORTLISTED-stage entries only for now; the hiring-pipeline UI
 * (stage transitions, filtering by stage) is a follow-up, not this pass —
 * see ShortlistStage's doc comment on the API side.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import { Badge } from '@/components/ui';

const { api } = employerApi;

interface ShortlistSkill {
  skillId: string;
  skillName: string;
  level: string;
  verifiedBy: 'TEST' | 'DISCUSSION';
  verifyHash: string;
}

interface ShortlistEntry {
  id: string;
  candidateId: string;
  fullName: string | null;
  headline: string | null;
  verifiedSkills: ShortlistSkill[];
  job: { id: string; title: string } | null;
  stage: string;
  note: string | null;
  createdAt: string;
}

export default function EmployerShortlist() {
  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await api<ShortlistEntry[]>('/shortlist?stage=SHORTLISTED');
      setEntries(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this candidate from the shortlist?')) return;
    setRemovingId(id);
    setError('');
    try {
      await api(`/shortlist/${id}`, { method: 'DELETE' });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  function startEditNote(entry: ShortlistEntry) {
    setEditingNoteId(entry.id);
    setNoteDraft(entry.note ?? '');
  }

  async function saveNote(id: string) {
    setSavingNote(true);
    setError('');
    try {
      const updated = await api<ShortlistEntry>(`/shortlist/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ note: noteDraft.trim() || null }),
      });
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, note: updated.note } : e)));
      setEditingNoteId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <main>
      <h1>Shortlist</h1>
      <p>Candidates you&apos;ve collected from applicants, search, and matches — the starting point for your hiring pipeline.</p>

      {error && <p className="error">{error}</p>}
      {loading && <p className="meta">Loading…</p>}

      {!loading && entries.length === 0 && (
        <p className="meta">
          Nothing shortlisted yet. Add candidates from a job&apos;s applicants or matches, or from{' '}
          <Link href="/employer">Find candidates</Link>.
        </p>
      )}

      {entries.map((e) => (
        <div key={e.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <strong>{e.fullName || 'Candidate'}</strong>
            <button className="btn-danger" onClick={() => remove(e.id)} disabled={removingId === e.id}>
              {removingId === e.id ? 'Removing…' : 'Remove'}
            </button>
          </div>
          {e.headline && <div className="meta">{e.headline}</div>}
          <div className="meta">
            {e.job ? `For: ${e.job.title}` : 'General shortlist (not tied to a job)'}
            {' · '}Added {new Date(e.createdAt).toLocaleDateString()}
          </div>

          {e.verifiedSkills.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', margin: 0, marginTop: 4 }}>
              {e.verifiedSkills.map((s) => (
                <Link key={s.skillId} href={`/badges/${s.verifyHash}`}>
                  <Badge variant="verified" title={s.verifiedBy === 'DISCUSSION' ? 'Verified by discussion' : 'Verified by test'}>
                    {s.skillName} ({s.level}) {s.verifiedBy === 'DISCUSSION' ? '💬' : ''}
                  </Badge>
                </Link>
              ))}
            </div>
          )}

          {editingNoteId === e.id ? (
            <div className="field" style={{ marginTop: 4 }}>
              <label htmlFor={`note-${e.id}`}>Note</label>
              <textarea
                id={`note-${e.id}`}
                rows={3}
                value={noteDraft}
                onChange={(ev) => setNoteDraft(ev.target.value)}
                placeholder="Why this candidate, next steps, anything the hiring team should know…"
              />
              <div className="row" style={{ margin: 0 }}>
                <button onClick={() => saveNote(e.id)} disabled={savingNote}>
                  {savingNote ? 'Saving…' : 'Save note'}
                </button>
                <button className="btn-secondary" onClick={() => setEditingNoteId(null)} disabled={savingNote}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="row" style={{ alignItems: 'center', margin: 0, marginTop: 4 }}>
              {e.note ? <p style={{ margin: 0, flex: 1 }}>{e.note}</p> : <span className="meta" style={{ margin: 0, flex: 1 }}>No note</span>}
              <button className="btn-secondary" onClick={() => startEditNote(e)}>
                {e.note ? 'Edit note' : 'Add note'}
              </button>
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
