'use client';

/** Candidate profile editor: GET/PATCH /profiles/me */
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, apiBlob } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { isSafeReturnTo } from '@/lib/returnTo';
import { useRequireAuth } from '@/lib/useRequireAuth';
import CertificationsPanel from '@/components/CertificationsPanel';

/**
 * Structured role dropdown — display/filter only, mirrors the API's
 * CandidateRoleTitle enum. NEVER wire this into any matching/scoring logic;
 * see scoring.ts's own warning comment. '' means "not set" in form state.
 */
type CandidateRoleTitle =
  | 'AI_ENGINEER'
  | 'ML_ENGINEER'
  | 'PROMPT_ENGINEER'
  | 'DATA_SCIENTIST'
  | 'MLOPS_ENGINEER'
  | 'NLP_ENGINEER'
  | 'COMPUTER_VISION_ENGINEER'
  | 'RESEARCH_ENGINEER'
  | 'DATA_ENGINEER'
  | 'AI_PRODUCT_MANAGER'
  | 'OTHER';

const ROLE_TITLE_LABELS: Record<CandidateRoleTitle, string> = {
  AI_ENGINEER: 'AI Engineer',
  ML_ENGINEER: 'ML Engineer',
  PROMPT_ENGINEER: 'Prompt Engineer',
  DATA_SCIENTIST: 'Data Scientist',
  MLOPS_ENGINEER: 'MLOps Engineer',
  NLP_ENGINEER: 'NLP Engineer',
  COMPUTER_VISION_ENGINEER: 'Computer Vision Engineer',
  RESEARCH_ENGINEER: 'Research Engineer',
  DATA_ENGINEER: 'Data Engineer',
  AI_PRODUCT_MANAGER: 'AI Product Manager',
  OTHER: 'Other',
};

const ROLE_TITLE_OPTIONS = Object.keys(ROLE_TITLE_LABELS) as CandidateRoleTitle[];

interface Profile {
  id: string;
  fullName: string | null;
  email: string | null;
  headline: string | null;
  roleTitle: CandidateRoleTitle | null;
  roleTitleOther: string | null;
  location: string | null;
  yearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  completeness: number;
  resumeS3Key: string | null;
  /** Never a raw storage key — the photo itself is only ever fetched
   * through the authenticated GET /profiles/:id/photo proxy (see
   * loadPhoto below), never a public URL. */
  hasPhoto: boolean;
}

/** First letters of up to the first two words of a name, for the
 * placeholder avatar shown until a photo is set (or if one fails to
 * load). Falls back to a generic "?" for a candidate with no name yet. */
function initials(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

interface ResumeExtraction {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  skills: string[];
  /** AI's best guess at the closest dropdown match — a suggestion only, never auto-applied. */
  suggestedRoleTitle: CandidateRoleTitle | null;
}

interface ReviewForm {
  fullName: string;
  headline: string;
  location: string;
  yearsOfExp: string;
  /** Holds a CandidateRoleTitle key or '' — plain string like the other <select>-bound form fields. */
  roleTitle: string;
  roleTitleOther: string;
}

interface FormState {
  fullName: string;
  email: string;
  headline: string;
  /** Holds a CandidateRoleTitle key or '' — plain string like the other <select>-bound form fields. */
  roleTitle: string;
  roleTitleOther: string;
  location: string;
  yearsOfExp: string;
  githubUrl: string;
  linkedinUrl: string;
}

function toForm(p: Profile): FormState {
  return {
    fullName: p.fullName ?? '',
    email: p.email ?? '',
    headline: p.headline ?? '',
    roleTitle: p.roleTitle ?? '',
    roleTitleOther: p.roleTitleOther ?? '',
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

  const ready = useRequireAuth();
  const [form, setForm] = useState<FormState | null>(null);
  const [completeness, setCompleteness] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [hasResume, setHasResume] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const [profileId, setProfileId] = useState<string | null>(null);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  // Tracks the currently-displayed blob: URL so it can be revoked before
  // creating the next one (or on unmount) without needing photoUrl itself
  // as an effect dependency.
  const photoUrlRef = useRef<string | null>(null);

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [extraction, setExtraction] = useState<ResumeExtraction | null>(null);
  const [review, setReview] = useState<ReviewForm | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!ready) return;
    api<Profile>('/profiles/me')
      .then((p) => {
        setForm(toForm(p));
        setCompleteness(p.completeness);
        setHasResume(!!p.resumeS3Key);
        setProfileId(p.id);
        setHasPhoto(p.hasPhoto);
        if (p.hasPhoto) loadPhoto(p.id);
      })
      .catch((e) => setError(e.message));
  }, [ready]);

  // Revoke the last blob: URL on unmount — createObjectURL'd blobs are
  // never freed automatically.
  useEffect(() => {
    return () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  /**
   * Fetches the photo bytes through the authenticated proxy (never a
   * public URL — see GET /profiles/:id/photo) and turns them into a
   * blob: URL for <img src>. A 404 (no photo, or one just removed) falls
   * back to the initials placeholder rather than showing an error — that
   * outcome isn't a failure from the candidate's point of view.
   */
  async function loadPhoto(id: string) {
    try {
      const blob = await apiBlob(`/profiles/${id}/photo`);
      const url = URL.createObjectURL(blob);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = url;
      setPhotoUrl(url);
    } catch {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
      setPhotoUrl(null);
    }
  }

  async function uploadPhoto() {
    if (!photoFile || !profileId) return;
    setUploadingPhoto(true);
    setPhotoError('');
    try {
      const body = new FormData();
      body.append('file', photoFile);
      await api('/profiles/me/photo', { method: 'POST', body });
      setHasPhoto(true);
      setPhotoFile(null);
      await loadPhoto(profileId);
    } catch (e) {
      setPhotoError((e as Error).message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function removePhoto() {
    setRemovingPhoto(true);
    setPhotoError('');
    try {
      await api('/profiles/me/photo', { method: 'DELETE' });
      setHasPhoto(false);
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
      setPhotoUrl(null);
    } catch (e) {
      setPhotoError((e as Error).message);
    } finally {
      setRemovingPhoto(false);
    }
  }

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
        roleTitle: form.roleTitle || undefined,
        // Only meaningful when roleTitle is OTHER — omitted otherwise so a
        // stale value from a previous OTHER selection doesn't linger unread.
        roleTitleOther: form.roleTitle === 'OTHER' ? form.roleTitleOther || undefined : undefined,
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
        // A suggestion the candidate must confirm below — never applied until "Looks good" is clicked.
        roleTitle: result.suggestedRoleTitle ?? '',
        roleTitleOther: '',
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
        roleTitle: review.roleTitle || undefined,
        roleTitleOther: review.roleTitle === 'OTHER' ? review.roleTitleOther || undefined : undefined,
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

  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main className="profile">
      <h1>Your profile</h1>
      <p>Keep this up to date — employers see it alongside your verified badges.</p>

      {isSafeReturnTo(returnTo) && (
        <p className="meta" style={{ marginTop: -16 }}>
          Complete your profile, then save to go straight back and apply.
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {form && (
        <>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${completeness}%` }} />
          </div>
          <p className="meta" style={{ marginBottom: 24 }}>{completeness}% complete</p>

          <div className="profile-columns">
          <section className="ui-card profile-panel">
          <h2>Profile details</h2>

          <div className="field">
            <label>Photo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt="Your profile photo"
                  style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--brand-100)',
                    color: 'var(--brand-800)',
                    fontSize: 24,
                    fontWeight: 600,
                  }}
                >
                  {initials(form.fullName)}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
                <input
                  id="photoFile"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                />
                <div className="row" style={{ margin: 0 }}>
                  <button onClick={uploadPhoto} disabled={!photoFile || uploadingPhoto}>
                    {uploadingPhoto ? 'Uploading…' : 'Upload photo'}
                  </button>
                  {hasPhoto && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={removePhoto}
                      disabled={removingPhoto}
                    >
                      {removingPhoto ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="meta" style={{ margin: 0 }}>JPEG, PNG, or WebP, up to 5MB.</p>
            {photoError && <p className="error" style={{ margin: 0 }}>{photoError}</p>}
          </div>

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
            <label htmlFor="roleTitle">Role</label>
            <select
              id="roleTitle"
              value={form.roleTitle}
              onChange={(e) => update('roleTitle', e.target.value)}
            >
              <option value="">Not set</option>
              {ROLE_TITLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{ROLE_TITLE_LABELS[r]}</option>
              ))}
            </select>
            {form.roleTitle === 'OTHER' && (
              <input
                value={form.roleTitleOther}
                onChange={(e) => update('roleTitleOther', e.target.value)}
                placeholder="Your role title"
                maxLength={160}
                style={{ marginTop: 8 }}
              />
            )}
            <p className="meta" style={{ margin: 0 }}>
              Shown to employers and used to filter candidate search — this never affects your
              match score, which is driven only by your verified skill badges.
            </p>
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
          </section>

          <div className="profile-side-col">
          <section className="ui-card profile-panel">
          <h2>Resume</h2>
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
                <label htmlFor="rvRoleTitle">
                  Role {extraction?.suggestedRoleTitle && <span className="meta">(AI suggestion — confirm or change)</span>}
                </label>
                <select
                  id="rvRoleTitle"
                  value={review.roleTitle}
                  onChange={(e) => setReview({ ...review, roleTitle: e.target.value })}
                >
                  <option value="">Not set</option>
                  {ROLE_TITLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{ROLE_TITLE_LABELS[r]}</option>
                  ))}
                </select>
                {review.roleTitle === 'OTHER' && (
                  <input
                    value={review.roleTitleOther}
                    onChange={(e) => setReview({ ...review, roleTitleOther: e.target.value })}
                    placeholder="Your role title"
                    maxLength={160}
                    style={{ marginTop: 8 }}
                  />
                )}
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
          </section>

          <CertificationsPanel />
          </div>
          </div>
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
