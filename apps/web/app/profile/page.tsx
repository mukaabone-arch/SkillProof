'use client';

/** Candidate profile editor: GET/PATCH /profiles/me */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { isSafeReturnTo } from '@/lib/returnTo';
import { Badge, EmptyState } from '@/components/ui';

interface Profile {
  fullName: string | null;
  email: string | null;
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
  email: string;
  headline: string;
  location: string;
  yearsOfExp: string;
  githubUrl: string;
  linkedinUrl: string;
}

type CredentialIssuer = 'CREDLY' | 'AWS' | 'GOOGLE' | 'AZURE' | 'NVIDIA' | 'DATABRICKS' | 'IBM' | 'OTHER';
type CredentialVerificationState = 'PENDING' | 'VERIFIED' | 'FAILED';

interface ExternalCredential {
  id: string;
  issuer: CredentialIssuer;
  name: string | null;
  credentialUrl: string;
  verificationState: CredentialVerificationState;
  issuedAt: string | null;
  expiresAt: string | null;
}

const ISSUER_LABELS: Record<CredentialIssuer, string> = {
  CREDLY: 'Credly',
  AWS: 'AWS',
  GOOGLE: 'Google',
  AZURE: 'Microsoft Azure',
  NVIDIA: 'NVIDIA',
  DATABRICKS: 'Databricks',
  IBM: 'IBM',
  OTHER: 'Unknown issuer',
};

// Mirrors the backend's CredlyVerificationService badge-URL pattern — kept
// client-side so we can reject non-badge URLs before ever hitting the API,
// instead of creating a doomed PENDING record for a link we already know
// can't verify.
const CREDLY_BADGE_URL_RE = /^https?:\/\/(?:www\.)?credly\.com\/badges\/[0-9a-fA-F-]{36}(?:[/?#].*)?$/;
const CREDLY_PROFILE_URL_RE = /^https?:\/\/(?:www\.)?credly\.com\/users\//i;

/** Empty string = valid (or nothing typed yet). */
function validateCredentialUrl(url: string): string {
  if (!url) return '';
  if (CREDLY_BADGE_URL_RE.test(url)) return '';
  if (CREDLY_PROFILE_URL_RE.test(url)) {
    return "That looks like a profile URL. Open a specific badge and paste its URL instead.";
  }
  return 'Paste the URL of a single Credly badge — it should look like credly.com/badges/<id>.';
}

function toForm(p: Profile): FormState {
  return {
    fullName: p.fullName ?? '',
    email: p.email ?? '',
    headline: p.headline ?? '',
    location: p.location ?? '',
    yearsOfExp: p.yearsOfExp !== null && p.yearsOfExp !== undefined ? String(p.yearsOfExp) : '',
    githubUrl: p.githubUrl ?? '',
    linkedinUrl: p.linkedinUrl ?? '',
  };
}

function ProfilePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

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

  const [credentials, setCredentials] = useState<ExternalCredential[]>([]);
  const [credentialUrl, setCredentialUrl] = useState('');
  const [addingCredential, setAddingCredential] = useState(false);
  const [credentialError, setCredentialError] = useState('');
  const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null);

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
    api<ExternalCredential[]>('/profiles/me/external-credentials')
      .then(setCredentials)
      .catch(() => undefined);
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
        email: form.email || undefined,
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

      // Came here from "complete your profile to apply" — go straight back
      // so the candidate can try applying again immediately.
      if (isSafeReturnTo(returnTo)) {
        router.push(returnTo);
        return;
      }
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

  async function addCredential() {
    const url = credentialUrl.trim();
    if (!url || validateCredentialUrl(url)) return;
    setAddingCredential(true);
    setCredentialError('');
    try {
      const created = await api<ExternalCredential>('/profiles/me/external-credentials', {
        method: 'POST',
        body: JSON.stringify({ credentialUrl: url }),
      });
      setCredentials((prev) => [created, ...prev]);
      setCredentialUrl('');
    } catch (e) {
      setCredentialError((e as Error).message);
    } finally {
      setAddingCredential(false);
    }
  }

  async function removeCredential(id: string) {
    setDeletingCredentialId(id);
    setCredentialError('');
    try {
      await api(`/profiles/me/external-credentials/${id}`, { method: 'DELETE' });
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setCredentialError((e as Error).message);
    } finally {
      setDeletingCredentialId(null);
    }
  }

  /**
   * Deliberately never uses Badge variant="verified" (the reserved
   * SkillProof-assessed green) — external credentials get the indigo
   * "default" pill instead, so the two proof tiers stay visually distinct
   * at a glance everywhere they're shown, here and on the employer side.
   */
  function credentialStatus(c: ExternalCredential) {
    if (c.verificationState === 'VERIFIED') {
      return <Badge variant="default">Verified via Credly</Badge>;
    }
    if (c.verificationState === 'FAILED') {
      return <Badge variant="danger">Couldn&apos;t verify</Badge>;
    }
    return <Badge variant="neutral">Pending</Badge>;
  }

  const credentialUrlError = validateCredentialUrl(credentialUrl.trim());

  return (
    <>
      {loggedIn && <CandidateNav onLoggedOut={() => setLoggedIn(false)} />}
      <main>
      <h1>Your profile</h1>
      <p>Keep this up to date — employers see it alongside your verified badges.</p>

      {ready && loggedIn && isSafeReturnTo(returnTo) && (
        <p className="meta" style={{ marginTop: -16 }}>
          Complete your profile, then save to go straight back and apply.
        </p>
      )}

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
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="you@example.com"
              maxLength={255}
            />
            <p className="meta" style={{ margin: 0 }}>
              Used to email you about job and application updates.
            </p>
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
          <p style={{ marginTop: -12 }}>
            Want a polished, downloadable resume instead? <Link href="/resume">Build one →</Link>
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

          <h2 style={{ marginTop: 32, marginBottom: 16 }}>External credentials</h2>
          <p>
            Add certifications from other platforms. Credly badge URLs are verified automatically
            by checking the badge is public — these are shown to employers as a separate,
            distinctly-styled tier from your SkillProof-verified skills, and never affect your
            match score.
          </p>

          <div className="field">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <label htmlFor="credentialUrl" style={{ margin: 0 }}>Credly badge URL</label>
              <details className="hint-toggle">
                <summary>How do I find this?</summary>
                <div className="hint-popover">
                  Paste the URL of one specific badge, not your Credly profile — it looks like{' '}
                  <code>credly.com/badges/&lt;id&gt;</code>.
                  <br />
                  To find it: open your Credly profile → click a badge → copy that page&apos;s URL.
                  Make sure the badge is set to <strong>public</strong> in Credly.
                </div>
              </details>
            </div>
            <input
              id="credentialUrl"
              value={credentialUrl}
              onChange={(e) => setCredentialUrl(e.target.value)}
              placeholder="https://www.credly.com/badges/..."
              className={credentialUrlError ? 'field-input-error' : undefined}
            />
            {credentialUrlError && <p className="field-error">{credentialUrlError}</p>}
          </div>
          <div className="row">
            <button
              onClick={addCredential}
              disabled={!credentialUrl.trim() || !!credentialUrlError || addingCredential}
            >
              {addingCredential ? 'Adding…' : 'Add credential'}
            </button>
          </div>
          {credentialError && <p className="error">{credentialError}</p>}

          {credentials.length === 0 ? (
            <EmptyState message="No external credentials yet — paste a Credly badge URL above to add one." />
          ) : (
            credentials.map((c) => (
              <div
                key={c.id}
                className="card"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
              >
                {credentialStatus(c)}

                {c.verificationState === 'VERIFIED' && (
                  <>
                    <strong>{c.name}</strong>
                    <div className="meta">{ISSUER_LABELS[c.issuer]}</div>
                    <div className="meta">
                      Issued {c.issuedAt ? new Date(c.issuedAt).toLocaleDateString() : 'Unknown'}
                      {' · '}
                      {c.expiresAt ? `Expires ${new Date(c.expiresAt).toLocaleDateString()}` : 'No expiration'}
                    </div>
                    <a href={c.credentialUrl} target="_blank" rel="noopener noreferrer">
                      View badge on Credly ↗
                    </a>
                  </>
                )}

                {c.verificationState === 'FAILED' && (
                  <p className="meta" style={{ margin: 0 }}>
                    Couldn&apos;t verify this badge — make sure it&apos;s set to public on Credly,
                    then remove this and paste the URL again.
                  </p>
                )}

                {c.verificationState === 'PENDING' && (
                  <p className="meta" style={{ margin: 0 }}>
                    We don&apos;t automatically verify this issuer yet — this link is saved but
                    unconfirmed.
                  </p>
                )}

                {c.verificationState !== 'VERIFIED' && (
                  <div className="meta" style={{ wordBreak: 'break-all' }}>{c.credentialUrl}</div>
                )}

                <div className="row" style={{ margin: 0, marginTop: 4 }}>
                  <button onClick={() => removeCredential(c.id)} disabled={deletingCredentialId === c.id}>
                    {deletingCredentialId === c.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}
      </main>
    </>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <ProfilePageInner />
    </Suspense>
  );
}
