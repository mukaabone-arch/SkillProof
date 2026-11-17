'use client';

/**
 * "Who can contact me" — the candidate's setting for AI sourcing
 * (GET/PUT /outreach/me/preferences): any matching role, only strong
 * matches, or nobody; plus a weekly cap on new messages.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ErrorState } from '@/components/ui';
import { CONTACT_OPTIONS, OutreachPreferences as Prefs, RecruiterContact } from '@/lib/outreach';

const WEEKLY_OPTIONS = [1, 2, 3, 5, 10];

export default function OutreachPreferences() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Prefs>('/outreach/me/preferences')
      .then(setPrefs)
      .catch((e) => setError((e as Error).message));
  }, []);

  async function save(patch: Partial<Pick<Prefs, 'recruiterContact' | 'outreachWeeklyLimit'>>) {
    setError('');
    setSaved(false);
    try {
      const next = await api<Prefs>('/outreach/me/preferences', { method: 'PUT', body: JSON.stringify(patch) });
      setPrefs(next);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!prefs) return error ? <ErrorState message={error} /> : null;

  return (
    <section id="contact-settings" className="card outreach-prefs">
      <h2 style={{ marginTop: 0 }}>Who can contact me</h2>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="visually-hidden">Who can contact me about roles</legend>
        {CONTACT_OPTIONS.map((o) => (
          <label key={o.value} className="outreach-pref-option">
            <input
              type="radio"
              name="recruiterContact"
              value={o.value}
              checked={prefs.recruiterContact === o.value}
              onChange={() => save({ recruiterContact: o.value as RecruiterContact })}
            />
            <span>
              <strong>{o.label}</strong>
              <span className="meta" style={{ display: 'block' }}>{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {prefs.recruiterContact !== 'OFF' && (
        <div className="field" style={{ marginTop: 12, maxWidth: 320 }}>
          <label htmlFor="weekly-limit">New messages per week, at most</label>
          <select
            id="weekly-limit"
            value={prefs.outreachWeeklyLimit}
            onChange={(e) => save({ outreachWeeklyLimit: Number(e.target.value) })}
          >
            {WEEKLY_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}
      {prefs.recruiterContact !== 'OFF' && !prefs.openToStaffing && (
        <p className="meta" style={{ marginBottom: 0 }}>
          Recruitment agencies can reach you only if you also turn on <Link href="/profile#staffing">Open to recruiters</Link>.
          Employers hiring for themselves can reach you already.
        </p>
      )}
      {saved && <p className="meta" role="status" style={{ marginBottom: 0 }}>Saved.</p>}
      {error && <ErrorState message={error} />}
    </section>
  );
}
