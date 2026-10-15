'use client';

/** Candidate profile editor: GET/PATCH /profiles/me */
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, apiBlob } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { isSafeReturnTo } from '@/lib/returnTo';
import { useRequireAuth } from '@/lib/useRequireAuth';
import CertificationsPanel from '@/components/CertificationsPanel';
import ProfileViewersPanel from '@/components/ProfileViewersPanel';
import { LocationAutocomplete, LocationSuggestion } from '@/components/LocationAutocomplete';
import { initialsFrom } from '@/lib/initials';
import { skillLevelName } from '@/lib/skillLevels';
import type { PortfolioContent, VerifiedBadge, VerifiedCertification } from '@/lib/portfolioTypes';

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
  /**
   * Structured city selection from GET /locations/search — non-null once
   * the candidate has re-selected from the dropdown; locationCity is the
   * presence signal (see locationDisplay below). ISO 3166-1 alpha-2 for
   * locationCountry (e.g. "US"), never a display name.
   */
  locationCity: string | null;
  locationRegion: string | null;
  locationCountry: string | null;
  locationPlaceId: string | null;
  locationLat: number | null;
  locationLng: number | null;
  /** Pre-migration free-text value — never dropped. Shown as the current
   * location until locationCity is set; see locationDisplay. */
  locationLegacy: string | null;
  /** Independent of location — a candidate open to remote work shouldn't
   * be excluded by any future location-based filter/matching. */
  openToRemote: boolean;
  yearsOfExp: number | null;
  /** Years working specifically with AI/ML — a subset of yearsOfExp. */
  aiYearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  completeness: number;
  resumeS3Key: string | null;
  /** Never a raw storage key — the photo itself is only ever fetched
   * through the authenticated GET /profiles/:id/photo proxy (see
   * loadPhoto below), never a public URL. */
  hasPhoto: boolean;
}

/** Structured-preferred display string, same precedence as the API's own
 * ProfilesService.formatCandidateLocation — never invented independently. */
function locationDisplay(p: Pick<Profile, 'locationCity' | 'locationRegion' | 'locationCountry' | 'locationLegacy'>): string {
  if (p.locationCity) return [p.locationCity, p.locationRegion, p.locationCountry].filter(Boolean).join(', ');
  return p.locationLegacy ?? '';
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

/**
 * GET /portfolio/me — same shape app/portfolio/page.tsx reads, fetched here
 * too (not re-exported from a shared type, to match that page's own local
 * interface rather than inventing a third source of truth) for two fields
 * this page didn't need before: `parsedAt` (Zone 1's quiet-state condition
 * — see the resume zone below) and `verifiedBadges`/`verifiedCertifications`
 * (Zone 3's "Your proof" — see CertificationsPanel's neighbour below).
 * `content`/`approvedAt`/`visibleToEmployers` are fetched now too, ahead of
 * when Zone 4 needs them, so that work doesn't require a second call later.
 */
interface PortfolioMe {
  hasResume: boolean;
  content: PortfolioContent | null;
  approvedAt: string | null;
  visibleToEmployers: boolean;
  parsedAt: string | null;
  verifiedBadges: VerifiedBadge[];
  verifiedCertifications: VerifiedCertification[];
}

interface FormState {
  fullName: string;
  email: string;
  headline: string;
  /** Holds a CandidateRoleTitle key or '' — plain string like the other <select>-bound form fields. */
  roleTitle: string;
  roleTitleOther: string;
  /** What's shown/typed in the location field — a formatted selection, the
   * legacy free-text value, or whatever the candidate is currently typing. */
  locationText: string;
  /** Non-null only when the candidate picked a suggestion from the dropdown
   * this session — that's what tells save() to write the structured fields
   * instead of locationLegacy. Typing (without picking) clears this back
   * to null, same as a failed search falling back to free text. */
  locationStructured: LocationSuggestion | null;
  /** From the server at load — true means this profile already has a
   * structured city on file, so the "re-select from the dropdown" prompt
   * never needs to show regardless of what's typed afterward. */
  hasStructuredLocationOnServer: boolean;
  openToRemote: boolean;
  yearsOfExp: string;
  aiYearsOfExp: string;
  githubUrl: string;
  linkedinUrl: string;
}

/**
 * Mirrors ProfilesService.computeCompleteness's own 7 equally-weighted
 * fields exactly (fullName, headline, location, yearsOfExp, githubUrl,
 * linkedinUrl, email) — same fields, same order — so the progress bar can
 * name what's actually missing instead of just reporting a percentage.
 * `locationText` stands in for the server's `locationCity ?? locationLegacy`
 * check: toForm() below only ever leaves it empty when both are null.
 * 100% is reachable (fill all 7) and every field here is already a Zone 2
 * input, which is what makes naming them worthwhile rather than removing
 * the meter outright.
 */
const COMPLETENESS_FIELDS: ReadonlyArray<[keyof FormState, string]> = [
  ['fullName', 'full name'],
  ['headline', 'headline'],
  ['locationText', 'location'],
  ['yearsOfExp', 'years of experience'],
  ['githubUrl', 'GitHub URL'],
  ['linkedinUrl', 'LinkedIn URL'],
  ['email', 'email'],
];

function toForm(p: Profile): FormState {
  return {
    fullName: p.fullName ?? '',
    email: p.email ?? '',
    headline: p.headline ?? '',
    roleTitle: p.roleTitle ?? '',
    roleTitleOther: p.roleTitleOther ?? '',
    locationText: locationDisplay(p),
    locationStructured: null,
    hasStructuredLocationOnServer: p.locationCity !== null,
    openToRemote: p.openToRemote,
    yearsOfExp: p.yearsOfExp !== null && p.yearsOfExp !== undefined ? String(p.yearsOfExp) : '',
    aiYearsOfExp: p.aiYearsOfExp !== null && p.aiYearsOfExp !== undefined ? String(p.aiYearsOfExp) : '',
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
  // Zone 2 fields currently holding a value copied in from the parse,
  // not yet confirmed by the candidate — see applyExtractionToForm below.
  // Cleared per-field the moment the candidate edits that field (update(),
  // and the two LocationAutocomplete callbacks), and cleared entirely on
  // a successful save() — "confirm or correct, then Save" is what
  // confirms a suggestion now, there's no separate apply step.
  const [suggestedFields, setSuggestedFields] = useState<Set<keyof FormState>>(new Set());

  // Zone 1 (résumé) state. `portfolio` is null until the GET below resolves
  // — treated as "not parsed" meanwhile, same as a genuine null parsedAt,
  // so the zone fails open to its full prompt rather than flashing a quiet
  // state it can't back up yet.
  const [portfolio, setPortfolio] = useState<PortfolioMe | null>(null);
  // True once the candidate clicks "Replace" on the quiet state — reopens
  // the full upload prompt without losing the fact that a résumé already
  // exists. Reset to false after a fresh upload's own parse completes (see
  // uploadResume below), so a successful replace collapses the zone back
  // to quiet on the new parsedAt rather than staying pinned open.
  const [replacingResume, setReplacingResume] = useState(false);

  function loadPortfolio() {
    return api<PortfolioMe>('/portfolio/me')
      .then(setPortfolio)
      // Best-effort, same convention as ProfileViewersPanel's own GET: a
      // failure here degrades Zone 1 to its full prompt state (see above)
      // rather than blocking the rest of the page, which has nothing to
      // do with portfolio data.
      .catch(() => undefined);
  }

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
    loadPortfolio();
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

  function clearSuggested(key: keyof FormState) {
    setSuggestedFields((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
    clearSuggested(key);
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
        githubUrl: form.githubUrl || undefined,
        linkedinUrl: form.linkedinUrl || undefined,
        openToRemote: form.openToRemote,
      };
      if (form.yearsOfExp !== '') body.yearsOfExp = Number(form.yearsOfExp);
      if (form.aiYearsOfExp !== '') body.aiYearsOfExp = Number(form.aiYearsOfExp);
      if (form.locationStructured) {
        // A real dropdown pick this session — write the structured fields,
        // never locationLegacy.
        body.locationCity = form.locationStructured.city;
        body.locationRegion = form.locationStructured.region || undefined;
        body.locationCountry = form.locationStructured.country;
        body.locationPlaceId = form.locationStructured.placeId;
        body.locationLat = form.locationStructured.lat ?? undefined;
        body.locationLng = form.locationStructured.lng ?? undefined;
      } else {
        // No structured pick this session (search failed, or the candidate
        // just hasn't re-selected yet) — free text, never dropped.
        body.locationLegacy = form.locationText || undefined;
      }

      const updated = await api<Profile>('/profiles/me', {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setForm(toForm(updated));
      setCompleteness(updated.completeness);
      setSaved(true);
      // Saving is the confirm step now (see suggestedFields above) —
      // whatever was AI-suggested a moment ago is now just the profile.
      setSuggestedFields(new Set());

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

  /**
   * Merges a resume-field extraction directly into the main profile form
   * — no separate review/apply step, no second PATCH. Confirming a
   * suggestion is now just editing (or leaving, then saving) the same
   * field everything else lives in; see suggestedFields above for how
   * that's tracked and surfaced, and save() for how it's cleared.
   *
   * Only fills fields that are currently EMPTY in the form — never
   * overwrites something already there, whether loaded from a previous
   * save or typed this session. A brand-new profile (every field blank)
   * gets fully filled, which is the case this exists for; a returning
   * candidate who replaces their résumé doesn't get their own edits
   * silently clobbered by a fresh parse.
   */
  function applyExtractionToForm(result: ResumeExtraction) {
    setExtraction(result);
    // `filled` is computed AND consumed inside this one updater — reading
    // it after calling setForm (rather than from within the updater
    // itself) would race React's own batching: the updater isn't
    // guaranteed to have run yet at that point, so filled could still read
    // empty. Calling setSuggestedFields/setSaved from inside the updater
    // instead means they only ever act on the same pass that actually
    // computed filled.
    setForm((f) => {
      if (!f) return f;
      const next = { ...f };
      const filled = new Set<keyof FormState>();
      if (result.fullName && !f.fullName) {
        next.fullName = result.fullName;
        filled.add('fullName');
      }
      if (result.headline && !f.headline) {
        next.headline = result.headline;
        filled.add('headline');
      }
      if (result.location && !f.locationText) {
        next.locationText = result.location;
        next.locationStructured = null;
        filled.add('locationText');
      }
      if (result.yearsOfExp !== null && result.yearsOfExp !== undefined && f.yearsOfExp === '') {
        next.yearsOfExp = String(result.yearsOfExp);
        filled.add('yearsOfExp');
      }
      if (result.suggestedRoleTitle && !f.roleTitle) {
        next.roleTitle = result.suggestedRoleTitle;
        filled.add('roleTitle');
      }
      if (filled.size > 0) {
        setSuggestedFields((prev) => {
          const merged = new Set(prev);
          filled.forEach((key) => merged.add(key));
          return merged;
        });
        setSaved(false);
      }
      return next;
    });
  }

  async function uploadResume() {
    if (!resumeFile) return;
    setUploading(true);
    setUploadError('');
    setUploaded(false);
    setParseError('');
    try {
      const body = new FormData();
      body.append('file', resumeFile);
      await api('/profiles/me/resume', { method: 'POST', body });
      setHasResume(true);
      setUploaded(true);
      setExtraction(null);
      // The upload request already waited on the server's own parse
      // attempt (ProfilesController.uploadResume awaits
      // PortfolioService.parseFromResume before responding — see that
      // method's doc comment), so parsedAt is already settled by the time
      // this resolves; re-fetching now picks up its real value instead of
      // assuming success. A silent parse failure there (caught and logged
      // server-side, never thrown) leaves parsedAt at whatever it was
      // before — unchanged on a first upload, stale on a replace — which
      // correctly keeps this zone from going quiet on a parse that didn't
      // actually happen.
      await loadPortfolio();
      setReplacingResume(false);

      // Auto-chain straight into the field-parse, fired from here — the
      // upload's own success path — rather than from an effect watching
      // hasResume, so it runs exactly once per actual upload click and
      // never spuriously (a reload, an unrelated re-render). This is what
      // makes Zone 1's "Upload your résumé and we'll fill this in" promise
      // literally true instead of requiring a second "Parse with AI"
      // click. A failure here is isolated with its own try/catch and its
      // own error state (parseError, surfaced below with a retry) — it
      // must never read as the upload itself having failed, since by this
      // point the file is already safely stored and Zone 1 has already
      // gone quiet. True "don't re-parse an identical file" dedup isn't
      // possible here: ProfilesController.uploadResume keys every upload
      // on a fresh randomUUID() regardless of file content, so there's no
      // signal anywhere that two uploads are byte-identical — the
      // once-per-click guarantee above is the dedup this can actually
      // offer today.
      setParsing(true);
      try {
        const result = await api<ResumeExtraction>('/profiles/me/resume/parse', { method: 'POST' });
        applyExtractionToForm(result);
      } catch (e) {
        setParseError((e as Error).message);
      } finally {
        setParsing(false);
      }
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  /** Manual re-run — e.g. after a chained parse failed, or to re-extract
   * without replacing the file. Shares applyExtractionToForm with the
   * auto-chain above so both ever write the form the same way. */
  async function parseResume() {
    setParsing(true);
    setParseError('');
    try {
      const result = await api<ResumeExtraction>('/profiles/me/resume/parse', { method: 'POST' });
      applyExtractionToForm(result);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main className="container-standard">
      <h1>Your profile</h1>
      <p>Keep this up to date — employers see it alongside your verified badges.</p>
      <p style={{ marginTop: -16 }}>
        <Link href="/profile/account">Account settings →</Link>
        {' · '}
        <Link href="/profile/billing">Billing documents →</Link>
      </p>

      {isSafeReturnTo(returnTo) && (
        <p className="meta" style={{ marginTop: -16 }}>
          Complete your profile, then save to go straight back and apply.
        </p>
      )}

      {/* The payoff, not evidence or an output — mounted ahead of
          everything else (including the progress bar, outside the
          `form &&` gate below) so a returning candidate with employer
          interest sees that first. Renders nothing at zero views; see
          ProfileViewersPanel's own doc comment for why absence, not an
          empty-state card, is the deliberate zero state here. */}
      <ProfileViewersPanel />

      {error && <ErrorState message={error} />}

      {form && (
        <>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${completeness}%` }} />
          </div>
          <p className="meta" style={{ marginBottom: 24 }}>
            {completeness}% complete
            {completeness < 100 &&
              (() => {
                const missing = COMPLETENESS_FIELDS.filter(([key]) => !form[key]).map(([, label]) => label);
                return missing.length > 0 ? ` — add your ${missing.join(', ')}` : '';
              })()}
          </p>

          {/* Zone 1 — résumé upload. Full width, above the two-column
              layout: the page's primary action, not one card among several
              (see this page's own restructure notes — four same-underlying-
              thing cards collapsed into this zone plus the proof/output
              zones below). Quiet state (profile-resume-quiet) once a parse
              is already on file, so a returning candidate isn't re-asked to
              do something they've done — see `portfolio` state above for
              why that's keyed off CandidatePortfolio.parsedAt rather than
              just resumeS3Key's presence: an upload whose parse silently
              failed server-side should still read as "not done" here, not
              as quiet. */}
          <section className="ui-card profile-panel profile-resume-zone">
            {portfolio?.parsedAt && hasResume && !replacingResume ? (
              <p className="profile-resume-quiet">
                Résumé parsed {new Date(portfolio.parsedAt).toLocaleDateString()}
                {' · '}
                <button type="button" className="btn-link" onClick={() => setReplacingResume(true)}>
                  Replace
                </button>
              </p>
            ) : (
              <>
                <h2>Upload your résumé and we&apos;ll fill this in</h2>
                <p>PDF, up to 5MB. Nothing is saved to your profile until you review it.</p>

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
                    {uploading ? (parsing ? 'Reading your résumé…' : 'Uploading…') : 'Upload'}
                  </button>
                  {/* Manual fallback — the upload button above already chains
                      straight into this same extraction (see uploadResume),
                      so this is for re-running it without replacing the
                      file: after a chained parse failed (paired with the
                      retry below), or just to pull fresh suggestions. */}
                  <button onClick={parseResume} disabled={!hasResume || parsing}>
                    {parsing ? 'Reading your résumé…' : 'Parse with AI'}
                  </button>
                  {replacingResume && (
                    <button type="button" className="btn-secondary" onClick={() => setReplacingResume(false)}>
                      Cancel
                    </button>
                  )}
                </div>
                {uploaded && <p className="ok">✓ Resume uploaded</p>}
                {uploadError && <ErrorState message={uploadError} />}
                {parseError && (
                  <div className="row" style={{ alignItems: 'baseline' }}>
                    <ErrorState message={parseError} />
                    <button type="button" className="btn-link" onClick={parseResume} disabled={parsing}>
                      Try again
                    </button>
                  </div>
                )}
                {extraction && !parseError && !parsing && (
                  <p className="ok">
                    ✓ Filled in your details below from the résumé — review and save when ready.
                  </p>
                )}
                {extraction && extraction.skills.length > 0 && (
                  <p className="meta" style={{ margin: 0 }}>
                    Skills detected (informational — not saved automatically): {extraction.skills.join(', ')}
                  </p>
                )}
              </>
            )}
          </section>

          <div className="list-page-columns">
          <section className="ui-card profile-panel list-page-main">
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
                  {initialsFrom(form.fullName)}
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
            {photoError && <ErrorState message={photoError} />}
          </div>

          <div className="field">
            <label htmlFor="fullName">
              Full name {suggestedFields.has('fullName') && <span className="meta">(from your résumé — confirm or correct)</span>}
            </label>
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
            <label htmlFor="headline">
              Headline {suggestedFields.has('headline') && <span className="meta">(from your résumé — confirm or correct)</span>}
            </label>
            <input
              id="headline"
              value={form.headline}
              onChange={(e) => update('headline', e.target.value)}
              placeholder="e.g. Backend engineer, 5 yrs Node/Go"
              maxLength={160}
            />
          </div>

          <div className="field">
            <label htmlFor="roleTitle">
              Role {suggestedFields.has('roleTitle') && <span className="meta">(AI suggestion from your résumé — confirm or change)</span>}
            </label>
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
            <label htmlFor="location">
              Location {suggestedFields.has('locationText') && <span className="meta">(from your résumé — confirm or correct)</span>}
            </label>
            <LocationAutocomplete
              id="location"
              value={form.locationText}
              onChangeText={(text) => {
                setForm((f) => (f ? { ...f, locationText: text, locationStructured: null } : f));
                setSaved(false);
                clearSuggested('locationText');
              }}
              onSelect={(s) => {
                setForm((f) =>
                  f
                    ? {
                        ...f,
                        locationText: [s.city, s.region, s.country].filter(Boolean).join(', '),
                        locationStructured: s,
                      }
                    : f,
                );
                setSaved(false);
                clearSuggested('locationText');
              }}
              placeholder="Start typing a city…"
            />
            {!form.hasStructuredLocationOnServer && !form.locationStructured && form.locationText && (
              <p className="meta" style={{ margin: 0 }}>
                This is your previously entered location — pick it from the dropdown above to make it
                official and unlock location-aware features later.
              </p>
            )}
          </div>

          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={form.openToRemote}
                onChange={(e) => {
                  setForm((f) => (f ? { ...f, openToRemote: e.target.checked } : f));
                  setSaved(false);
                }}
                style={{ width: 'auto' }}
              />
              Open to remote work
            </label>
            <p className="meta" style={{ margin: 0 }}>
              Keeps you visible to remote roles regardless of your location.
            </p>
          </div>

          <div className="field">
            <label htmlFor="yearsOfExp">
              Years of experience {suggestedFields.has('yearsOfExp') && <span className="meta">(from your résumé — confirm or correct)</span>}
            </label>
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
            <label htmlFor="aiYearsOfExp">AI experience</label>
            <input
              id="aiYearsOfExp"
              type="number"
              min={0}
              max={80}
              value={form.aiYearsOfExp}
              onChange={(e) => update('aiYearsOfExp', e.target.value)}
            />
            <p className="meta" style={{ margin: 0 }}>
              Years working specifically with AI/ML systems — part of your total experience above.
            </p>
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

          <div className="profile-side-col list-page-sidebar">
          {/* Zone 3 — Your proof. Verified badges and certifications are
              the same category from the candidate's point of view
              (evidence), grouped under one eyebrow label rather than one
              physical card — CertificationsPanel owns its own ui-card
              chrome and isn't worth un-nesting from this component just to
              share a box with the badges card below it. */}
          <p className="eyebrow">Your proof</p>
          {portfolio && (
            <section className="ui-card profile-panel">
              <h2>Verified skills</h2>
              {/*
                * Badge chip row duplicated from PortfolioSections.tsx's
                * "Verified on MyAmbii" subsection (same GET /portfolio/me
                * data, same .signal-chip-row/.chip treatment) rather than
                * imported from there — that component's badges markup is
                * inline, not an extracted sub-component, and refactoring it
                * to share one isn't worth the risk two weeks from launch on
                * a page (the portfolio editor) that otherwise has nothing
                * to do with this change. Known duplication: if the visual
                * treatment changes, it needs updating in both places until
                * someone unifies them after launch.
                *
                * Empty state written first and deliberately not an
                * afterthought: most candidates loading this page have no
                * verified skills yet, and this is the best-placed prompt
                * into a first assessment anywhere in the product.
                */}
              {portfolio.verifiedBadges.length > 0 ? (
                <div className="signal-chip-row">
                  {portfolio.verifiedBadges.map((b) => (
                    <Link key={b.skillId} href={`/badges/${b.verifyHash}`}>
                      <span className="chip" title={`Verified ${new Date(b.issuedAt).toLocaleDateString()}`}>
                        {b.skillName} · {skillLevelName(b.level)}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  message="No verified skills yet — self-reported skills aren't independently tested."
                  actionLabel="Take an assessment"
                  actionHref="/assessments"
                />
              )}
            </section>
          )}

          <CertificationsPanel />

          {/* Zone 4 — What employers see. Outputs, not builders: a link to
              the rendered portfolio (with its actual visibility state, not
              assumed) and a link to the PDF builder — both collapsed from
              their old separate "build a ___" cards into one section, same
              reasoning as Zone 3 above. "Your public page" is the honest
              label available today: there is no unauthenticated, truly
              public URL (checked — the only non-owner portfolio view is
              /employer/candidates/[id]/portfolio, itself employer-gated),
              so this links to the candidate's own /portfolio rather than
              a link meant for external sharing. */}
          <p className="eyebrow" style={{ marginTop: 8 }}>What employers see</p>
          <section className="ui-card profile-panel">
            <h2>Your public page</h2>
            <p>
              {!portfolio?.visibleToEmployers
                ? 'Not visible to employers yet.'
                : portfolio.approvedAt
                  ? "Visible to employers you've engaged with."
                  : 'Not shown yet — approve your draft first.'}
            </p>
            <Link href="/portfolio">
              <button>Review your portfolio →</button>
            </Link>
          </section>

          <section className="ui-card profile-panel">
            <h2>Download as PDF</h2>
            <p>
              A clean, one-page resume built from your profile and verified badges — or rewritten
              by AI from an uploaded resume. Review and edit everything before downloading.
            </p>
            <Link href="/resume">
              <button>Build your resume →</button>
            </Link>
          </section>
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
    <Suspense fallback={<main className="container-standard"><LoadingState /></main>}>
      <ProfilePageInner />
    </Suspense>
  );
}
