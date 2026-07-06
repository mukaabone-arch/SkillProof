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
  resumeS3Key: string | null;
}

interface ResumeExtraction {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  skills: string[];
}

interface ReviewForm {
  fullName: string;
  headline: string;
  location: string;
  yearsOfExp: string;
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

  const [hasResume, setHasResume] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [extraction, setExtraction] = useState<ResumeExtraction | null>(null);
  const [review, setReview] = useState<ReviewForm | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    const hasToken = !!getToken();
    setLoggedIn(hasToken);
    setReady(true);
    if (!hasToken) return;
    api<Profile>('/profiles/me')
      .then((p) => {
        setForm(toForm(p));
        setCompleteness(p.completeness);
        setHasResume(!!p.resumeS3Key);
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

  async function uploadResume() {
    if (!resumeFile) return;
    setUploading(true);
    setUploadError('');
    setUploaded(false);
    try {
      const body = new FormData();
      body.append('file', resumeFile);
      await api('/profiles/me/resume', { method: 'POST', body });
      setHasResume(true);
      setUploaded(true);
      setExtraction(null);
      setReview(null);
      setApplied(false);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function parseResume() {
    setParsing(true);
    setParseError('');
    try {
      const result = await api<ResumeExtraction>('/profiles/me/resume/parse', { method: 'POST' });
      setExtraction(result);
      setReview({
        fullName: result.fullName ?? '',
        headline: result.headline ?? '',
        location: result.location ?? '',
        yearsOfExp:
          result.yearsOfExp !== null && result.yearsOfExp !== undefined ? String(result.yearsOfExp) : '',
      });
      setApplied(false);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function applyExtraction() {
    if (!review) return;
    setApplying(true);
    setParseError('');
    try {
      const body: Record<string, unknown> = {
        fullName: review.fullName || undefined,
        headline: review.headline || undefined,
        location: review.location || undefined,
      };
      if (review.yearsOfExp !== '') body.yearsOfExp = Number(review.yearsOfExp);

      const updated = await api<Profile>('/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setForm(toForm(updated));
      setCompleteness(updated.completeness);
      setApplied(true);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setApplying(false);
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

          <h2 style={{ marginTop: 32, marginBottom: 16 }}>Resume</h2>
          <p>
            Upload your resume as a PDF, then have AI pull out the highlights. Nothing is saved
            to your profile until you review and confirm it below.
          </p>

          <div className="field">
            <label htmlFor="resumeFile">PDF resume (max 5MB)</label>
            <input
              id="resumeFile"
              type="file"
              accept="application/pdf"
              onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="row">
            <button onClick={uploadResume} disabled={!resumeFile || uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <button onClick={parseResume} disabled={!hasResume || parsing}>
              {parsing ? 'Parsing…' : 'Parse with AI'}
            </button>
          </div>
          {uploaded && <p className="ok">✓ Resume uploaded</p>}
          {uploadError && <p className="error">{uploadError}</p>}
          {parseError && <p className="error">{parseError}</p>}

          {review && (
            <div
              className="card"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, marginTop: 8 }}
            >
              <strong>Review AI-extracted details</strong>
              <p className="meta" style={{ margin: 0 }}>
                Confirm or correct these before they&apos;re saved — nothing has been applied to
                your profile yet.
              </p>

              <div className="field">
                <label htmlFor="rvFullName">Full name</label>
                <input
                  id="rvFullName"
                  value={review.fullName}
                  onChange={(e) => setReview({ ...review, fullName: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="rvHeadline">Headline</label>
                <input
                  id="rvHeadline"
                  value={review.headline}
                  onChange={(e) => setReview({ ...review, headline: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="rvLocation">Location</label>
                <input
                  id="rvLocation"
                  value={review.location}
                  onChange={(e) => setReview({ ...review, location: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="rvYearsOfExp">Years of experience</label>
                <input
                  id="rvYearsOfExp"
                  type="number"
                  min={0}
                  max={80}
                  value={review.yearsOfExp}
                  onChange={(e) => setReview({ ...review, yearsOfExp: e.target.value })}
                />
              </div>

              {extraction && extraction.skills.length > 0 && (
                <div className="field">
                  <label>Skills detected (informational — not saved automatically)</label>
                  <p className="meta" style={{ margin: 0 }}>{extraction.skills.join(', ')}</p>
                </div>
              )}

              <div className="row" style={{ margin: 0 }}>
                <button onClick={applyExtraction} disabled={applying}>
                  {applying ? 'Applying…' : 'Looks good — apply to my profile'}
                </button>
                {applied && <p className="ok" style={{ margin: 0 }}>✓ Applied to your profile</p>}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
