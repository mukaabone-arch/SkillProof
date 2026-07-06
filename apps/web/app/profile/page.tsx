'use client';

/** Candidate profile editor: GET/PATCH /profiles/me */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';

interface Profile {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  completeness: number;
}

interface FormState {
  fullName: string;
  headline: string;
  location: string;
  yearsOfExp: string;
  githubUrl: string;
  linkedinUrl: string;
}

function toForm(p: Profile): FormState {
  return {
    fullName: p.fullName ?? '',
    headline: p.headline ?? '',
    location: p.location ?? '',
    yearsOfExp: p.yearsOfExp !== null && p.yearsOfExp !== undefined ? String(p.yearsOfExp) : '',
    githubUrl: p.githubUrl ?? '',
    linkedinUrl: p.linkedinUrl ?? '',
  };
}

export default function ProfilePage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [completeness, setCompleteness] = useState(0);
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const hasToken = !!getToken();
    setLoggedIn(hasToken);
    setReady(true);
    if (!hasToken) return;
    api<Profile>('/profiles/me')
      .then((p) => {
        setForm(toForm(p));
        setCompleteness(p.completeness);
      })
      .catch((e) => setError(e.message));
  }, []);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        fullName: form.fullName || undefined,
        headline: form.headline || undefined,
        location: form.location || undefined,
        githubUrl: form.githubUrl || undefined,
        linkedinUrl: form.linkedinUrl || undefined,
      };
      if (form.yearsOfExp !== '') body.yearsOfExp = Number(form.yearsOfExp);

      const updated = await api<Profile>('/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setForm(toForm(updated));
      setCompleteness(updated.completeness);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main>
      <h1>Your profile</h1>
      <p>Keep this up to date — employers see it alongside your verified badges.</p>

      {ready && !loggedIn && (
        <p className="error">
          You are not logged in — <Link href="/">log in first</Link> to edit your profile.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {form && (
        <>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${completeness}%` }} />
          </div>
          <p className="meta" style={{ marginBottom: 24 }}>{completeness}% complete</p>

          <div className="field">
            <label htmlFor="fullName">Full name</label>
            <input
              id="fullName"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
              maxLength={120}
            />
          </div>

          <div className="field">
            <label htmlFor="headline">Headline</label>
            <input
              id="headline"
              value={form.headline}
              onChange={(e) => update('headline', e.target.value)}
              placeholder="e.g. Backend engineer, 5 yrs Node/Go"
              maxLength={160}
            />
          </div>

          <div className="field">
            <label htmlFor="location">Location</label>
            <input
              id="location"
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
              maxLength={120}
            />
          </div>

          <div className="field">
            <label htmlFor="yearsOfExp">Years of experience</label>
            <input
              id="yearsOfExp"
              type="number"
              min={0}
              max={80}
              value={form.yearsOfExp}
              onChange={(e) => update('yearsOfExp', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="githubUrl">GitHub URL</label>
            <input
              id="githubUrl"
              value={form.githubUrl}
              onChange={(e) => update('githubUrl', e.target.value)}
              placeholder="https://github.com/..."
              maxLength={255}
            />
          </div>

          <div className="field">
            <label htmlFor="linkedinUrl">LinkedIn URL</label>
            <input
              id="linkedinUrl"
              value={form.linkedinUrl}
              onChange={(e) => update('linkedinUrl', e.target.value)}
              placeholder="https://linkedin.com/in/..."
              maxLength={255}
            />
          </div>

          <div className="row">
            <button onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            {saved && <p className="ok" style={{ margin: 0 }}>✓ Saved</p>}
          </div>
        </>
      )}
    </main>
  );
}
