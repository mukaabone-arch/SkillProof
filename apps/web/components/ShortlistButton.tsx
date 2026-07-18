'use client';

/**
 * Toggle used on every employer-portal candidate surface (applicants list,
 * candidate search, match results) — "+ Shortlist" when not yet added,
 * "✓ Shortlisted" (click to remove) once it is. entryId is owned by the
 * parent (each surface loads its own shortlist status, see EmployerJobs /
 * CandidateSearch) so this component stays a thin, stateless-except-for-busy
 * wrapper around POST/DELETE /shortlist.
 */
import { useState } from 'react';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

interface Props {
  candidateId: string;
  jobId?: string;
  entryId: string | null;
  onAdded: (entryId: string) => void;
  onRemoved: () => void;
  onError: (message: string) => void;
}

export default function ShortlistButton({ candidateId, jobId, entryId, onAdded, onRemoved, onError }: Props) {
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const entry = await api<{ id: string }>('/shortlist', {
        method: 'POST',
        body: JSON.stringify({ candidateId, ...(jobId ? { jobId } : {}) }),
      });
      onAdded(entry.id);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entryId) return;
    setBusy(true);
    try {
      await api(`/shortlist/${entryId}`, { method: 'DELETE' });
      onRemoved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (entryId) {
    return (
      <button className="btn-secondary" onClick={remove} disabled={busy}>
        {busy ? 'Removing…' : '✓ Shortlisted'}
      </button>
    );
  }
  return (
    <button onClick={add} disabled={busy}>
      {busy ? 'Adding…' : '+ Shortlist'}
    </button>
  );
}
