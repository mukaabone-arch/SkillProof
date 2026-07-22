'use client';

/**
 * Candidate-facing certifications section: GET/POST/PATCH/DELETE
 * /profiles/me/certifications. Successor to the old Credly-only "External
 * credentials" section — same profile-page slot, now covering Coursera,
 * LinkedIn Learning, PMI, PeopleCert, AWS, Microsoft, Google, Scrum
 * Alliance, Udemy, edX, NPTEL, Credly, or a free-text Other issuer, each
 * with three trust tiers (see trustTier below) that must never be confused
 * for a SkillProof-verified skill badge — the same "verified" green Badge
 * variant stays reserved for that, exactly as it did before this change.
 */
import { useEffect, useState } from 'react';
import { api, apiBlob } from '@/lib/api';
import { Badge, EmptyState } from '@/components/ui';

type CertIssuer =
  | 'CREDLY'
  | 'COURSERA'
  | 'LINKEDIN_LEARNING'
  | 'PMI'
  | 'PEOPLECERT'
  | 'AWS'
  | 'MICROSOFT'
  | 'GOOGLE'
  | 'SCRUM_ALLIANCE'
  | 'UDEMY'
  | 'EDX'
  | 'NPTEL'
  | 'OTHER';

type CertVerificationStatus = 'VERIFIED' | 'LINK_PROVIDED' | 'SELF_REPORTED' | 'EXPIRED';
type CertVerificationSource = 'CREDLY' | 'URL' | 'MANUAL_UPLOAD';

interface Certification {
  id: string;
  name: string;
  issuer: CertIssuer;
  issuerOther: string | null;
  issueDate: string;
  expiryDate: string | null;
  credentialId: string | null;
  credentialUrl: string | null;
  /** Authenticated proxy path (never a raw storage key) — see the API's own doc comment. */
  fileUrl: string | null;
  verificationStatus: CertVerificationStatus;
  verificationSource: CertVerificationSource;
  skillTags: string[];
  isExpiringSoon: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Skill {
  id: string;
  name: string;
}

interface Domain {
  id: string;
  name: string;
  skills: Skill[];
}

const ISSUER_OPTIONS: CertIssuer[] = [
  'CREDLY',
  'COURSERA',
  'LINKEDIN_LEARNING',
  'PMI',
  'PEOPLECERT',
  'AWS',
  'MICROSOFT',
  'GOOGLE',
  'SCRUM_ALLIANCE',
  'UDEMY',
  'EDX',
  'NPTEL',
  'OTHER',
];

const ISSUER_LABELS: Record<CertIssuer, string> = {
  CREDLY: 'Credly',
  COURSERA: 'Coursera',
  LINKEDIN_LEARNING: 'LinkedIn Learning',
  PMI: 'PMI',
  PEOPLECERT: 'PeopleCert',
  AWS: 'AWS',
  MICROSOFT: 'Microsoft',
  GOOGLE: 'Google',
  SCRUM_ALLIANCE: 'Scrum Alliance',
  UDEMY: 'Udemy',
  EDX: 'edX',
  NPTEL: 'NPTEL',
  OTHER: 'Other',
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

interface FormState {
  name: string;
  issuer: CertIssuer | '';
  issuerOther: string;
  issueDate: string;
  expiryDate: string;
  credentialId: string;
  credentialUrl: string;
  skillTags: string[];
}

const EMPTY_FORM: FormState = {
  name: '',
  issuer: '',
  issuerOther: '',
  issueDate: '',
  expiryDate: '',
  credentialId: '',
  credentialUrl: '',
  skillTags: [],
};

function toForm(c: Certification): FormState {
  return {
    name: c.name,
    issuer: c.issuer,
    issuerOther: c.issuerOther ?? '',
    issueDate: c.issueDate.slice(0, 10),
    expiryDate: c.expiryDate ? c.expiryDate.slice(0, 10) : '',
    credentialId: c.credentialId ?? '',
    credentialUrl: c.credentialUrl ?? '',
    skillTags: c.skillTags,
  };
}

function daysUntil(dateStr: string): number {
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default function CertificationsPanel() {
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fileViewError, setFileViewError] = useState('');

  useEffect(() => {
    api<Certification[]>('/profiles/me/certifications')
      .then(setCertifications)
      .catch(() => undefined)
      .finally(() => setLoaded(true));
    api<Domain[]>('/taxonomy').then(setDomains).catch(() => undefined);
  }, []);

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFile(null);
    setFileError('');
    setSubmitError('');
    setFormOpen(true);
  }

  function startEdit(c: Certification) {
    setEditingId(c.id);
    setForm(toForm(c));
    setFile(null);
    setFileError('');
    setSubmitError('');
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  function onFileChange(f: File | null) {
    setFile(null);
    setFileError('');
    if (!f) return;
    if (!ACCEPTED_FILE_TYPES.includes(f.type)) {
      setFileError('Only PDF, PNG, or JPG files are accepted.');
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError('File is too large — the limit is 5MB.');
      return;
    }
    setFile(f);
  }

  function onSkillTagsChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
    setForm((f) => ({ ...f, skillTags: selected }));
  }

  const editingCert = editingId ? certifications.find((c) => c.id === editingId) ?? null : null;
  const keepsExistingProof = !!editingCert && (!!editingCert.credentialUrl || !!editingCert.fileUrl) && !file;

  const nameError = form.name.trim() ? '' : 'Required.';
  const issuerError = form.issuer ? '' : 'Required.';
  const issuerOtherError = form.issuer === 'OTHER' && !form.issuerOther.trim() ? 'Required when issuer is Other.' : '';
  const issueDateError = form.issueDate ? '' : 'Required.';
  const expiryOrderError =
    form.expiryDate && form.issueDate && form.expiryDate <= form.issueDate
      ? 'Expiry date must be after the issue date.'
      : '';
  const proofError =
    !form.credentialUrl.trim() && !file && !keepsExistingProof
      ? 'Provide either a credential URL or an upload (PDF/PNG/JPG).'
      : '';
  const formValid =
    !nameError && !issuerError && !issuerOtherError && !issueDateError && !expiryOrderError && !proofError && !fileError;

  async function submit() {
    if (!formValid) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const body = new FormData();
      body.append('name', form.name.trim());
      body.append('issuer', form.issuer);
      if (form.issuer === 'OTHER') body.append('issuerOther', form.issuerOther.trim());
      body.append('issueDate', form.issueDate);
      if (form.expiryDate) body.append('expiryDate', form.expiryDate);
      if (form.credentialId.trim()) body.append('credentialId', form.credentialId.trim());
      if (form.credentialUrl.trim()) body.append('credentialUrl', form.credentialUrl.trim());
      if (form.skillTags.length > 0) body.append('skillTags', JSON.stringify(form.skillTags));
      if (file) body.append('file', file);

      const saved = editingId
        ? await api<Certification>(`/profiles/me/certifications/${editingId}`, { method: 'PATCH', body })
        : await api<Certification>('/profiles/me/certifications', { method: 'POST', body });

      setCertifications((prev) =>
        editingId ? prev.map((c) => (c.id === saved.id ? saved : c)) : [saved, ...prev],
      );
      closeForm();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * The stored file is never a public URL — same authenticated-proxy
   * pattern as the profile photo (see profile/page.tsx's loadPhoto): open a
   * blank tab synchronously (so the browser still treats this as a direct
   * result of the click, not a blocked pop-up), then point it at a blob:
   * URL once the bytes arrive.
   */
  async function viewFile(path: string) {
    setFileViewError('');
    const win = window.open('', '_blank');
    try {
      const blob = await apiBlob(path);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
    } catch (e) {
      win?.close();
      setFileViewError((e as Error).message);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      await api(`/profiles/me/certifications/${id}`, { method: 'DELETE' });
      setCertifications((prev) => prev.filter((c) => c.id !== id));
      if (editingId === id) closeForm();
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * The three trust tiers, deliberately never using Badge variant="verified"
   * (the reserved SkillProof-assessed green) — same reasoning as the old
   * external-credentials section: proof from another platform, however
   * strongly verified, stays visually distinct from a SkillProof-assessed
   * skill. VERIFIED still gets the indigo "default" pill (unchanged from
   * before); LINK_PROVIDED steps down to a plain gray pill; SELF_REPORTED
   * steps down again to a borderless, unfilled outline — a self-uploaded
   * PMP must never look like a verified badge.
   */
  function trustTierBadge(c: Certification) {
    if (c.verificationStatus === 'EXPIRED') {
      return <Badge variant="warning">Expired</Badge>;
    }
    if (c.verificationStatus === 'VERIFIED') {
      return <Badge variant="default">Verified via Credly</Badge>;
    }
    if (c.verificationStatus === 'LINK_PROVIDED') {
      return <Badge variant="neutral">Link provided — unverified</Badge>;
    }
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 10px',
          borderRadius: 999,
          border: '1px solid var(--ink-30)',
          color: 'var(--ink-60)',
          fontSize: '0.8rem',
          fontWeight: 600,
        }}
      >
        Candidate-provided
      </span>
    );
  }

  const issuerLabel = (c: Certification) => (c.issuer === 'OTHER' ? c.issuerOther ?? 'Other' : ISSUER_LABELS[c.issuer]);

  const skillNameById = new Map(domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));

  if (!loaded) return null;

  return (
    <section className="ui-card profile-panel">
      <h2>Certifications</h2>
      <p>
        Add certifications from Credly, Coursera, LinkedIn Learning, PMI, PeopleCert, and other
        platforms. A live-verified Credly badge gets the strongest tier; a credential link is shown
        as unverified; a self-uploaded file is labelled candidate-provided — employers always see
        which is which, and only the verified tier ever affects your match score.
      </p>

      {!formOpen && (
        <div className="row">
          <button onClick={startAdd}>Add certification</button>
        </div>
      )}

      {formOpen && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
          <div className="field">
            <label htmlFor="certName">Name</label>
            <input
              id="certName"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Project Management Professional (PMP)"
              className={nameError ? 'field-input-error' : undefined}
            />
          </div>

          <div className="field">
            <label htmlFor="certIssuer">Issuer</label>
            <select
              id="certIssuer"
              value={form.issuer}
              onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value as CertIssuer }))}
              className={issuerError ? 'field-input-error' : undefined}
            >
              <option value="">Select an issuer…</option>
              {ISSUER_OPTIONS.map((i) => (
                <option key={i} value={i}>{ISSUER_LABELS[i]}</option>
              ))}
            </select>
          </div>

          {form.issuer === 'OTHER' && (
            <div className="field">
              <label htmlFor="certIssuerOther">Issuer name</label>
              <input
                id="certIssuerOther"
                value={form.issuerOther}
                onChange={(e) => setForm((f) => ({ ...f, issuerOther: e.target.value }))}
                className={issuerOtherError ? 'field-input-error' : undefined}
              />
              {issuerOtherError && <p className="field-error">{issuerOtherError}</p>}
            </div>
          )}

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="certIssueDate">Issue date</label>
              <input
                id="certIssueDate"
                type="date"
                value={form.issueDate}
                onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
                className={issueDateError ? 'field-input-error' : undefined}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="certExpiryDate">Expiry date (optional)</label>
              <input
                id="certExpiryDate"
                type="date"
                value={form.expiryDate}
                onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                className={expiryOrderError ? 'field-input-error' : undefined}
              />
            </div>
          </div>
          {expiryOrderError && <p className="field-error" style={{ marginTop: -10 }}>{expiryOrderError}</p>}

          <div className="field">
            <label htmlFor="certCredentialId">Credential ID (optional)</label>
            <input
              id="certCredentialId"
              value={form.credentialId}
              onChange={(e) => setForm((f) => ({ ...f, credentialId: e.target.value }))}
            />
          </div>

          <div className="field">
            <label htmlFor="certCredentialUrl">Credential URL (optional)</label>
            <input
              id="certCredentialUrl"
              value={form.credentialUrl}
              onChange={(e) => setForm((f) => ({ ...f, credentialUrl: e.target.value }))}
              placeholder="https://..."
            />
            {form.issuer === 'CREDLY' && (
              <p className="meta" style={{ margin: 0 }}>
                A public Credly badge URL is verified automatically — paste the badge page URL, not
                your profile URL.
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="certFile">
              Upload (PDF/PNG/JPG, max 5MB){!editingCert?.fileUrl && !form.credentialUrl ? '' : ' — optional'}
            </label>
            <input
              id="certFile"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
            {editingCert?.fileUrl && !file && (
              <p className="meta" style={{ margin: 0 }}>A file is already on record — choose a new one only to replace it.</p>
            )}
            {fileError && <p className="field-error">{fileError}</p>}
          </div>

          <div className="field">
            <label htmlFor="certSkillTags">Skill tags (optional)</label>
            <select
              id="certSkillTags"
              multiple
              size={6}
              value={form.skillTags}
              onChange={onSkillTagsChange}
            >
              {domains.map((d) => (
                <optgroup key={d.id} label={d.name}>
                  {d.skills.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="meta" style={{ margin: 0 }}>
              Ctrl/Cmd-click to select multiple. These feed your match score only once this
              certification is verified.
            </p>
          </div>

          {proofError && <p className="field-error">{proofError}</p>}
          {submitError && <p className="error">{submitError}</p>}

          <div className="row" style={{ marginTop: 4, marginBottom: 0 }}>
            <button onClick={submit} disabled={!formValid || submitting}>
              {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Add certification'}
            </button>
            <button onClick={closeForm} disabled={submitting}>Cancel</button>
          </div>
        </div>
      )}

      {fileViewError && <p className="error">{fileViewError}</p>}

      {certifications.length === 0 ? (
        <EmptyState message="No certifications yet — add one above." />
      ) : (
        certifications.map((c) => (
          <div key={c.id} className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {trustTierBadge(c)}
              {c.isExpiringSoon && (
                <Badge variant="warning">Expires in {c.expiryDate ? daysUntil(c.expiryDate) : 0} days</Badge>
              )}
            </div>
            <strong>{c.name}</strong>
            <div className="meta">{issuerLabel(c)}</div>
            <div className="meta">
              Issued {new Date(c.issueDate).toLocaleDateString()}
              {' · '}
              {c.expiryDate ? `Expires ${new Date(c.expiryDate).toLocaleDateString()}` : 'No expiration'}
            </div>
            {c.credentialId && <div className="meta">Credential ID: {c.credentialId}</div>}
            {c.credentialUrl && (
              <a href={c.credentialUrl} target="_blank" rel="noopener noreferrer">
                View credential ↗
              </a>
            )}
            {c.fileUrl && (
              <button
                onClick={() => viewFile(c.fileUrl!)}
                style={{ alignSelf: 'flex-start', padding: 0, border: 'none', background: 'none', color: 'var(--indigo)', cursor: 'pointer' }}
              >
                View uploaded file ↗
              </button>
            )}
            {c.skillTags.length > 0 && (
              <div className="meta">
                Skills: {c.skillTags.map((id) => skillNameById.get(id) ?? id).join(', ')}
              </div>
            )}
            <div className="row" style={{ margin: 0, marginTop: 4 }}>
              <button onClick={() => startEdit(c)}>Edit</button>
              <button onClick={() => remove(c.id)} disabled={deletingId === c.id}>
                {deletingId === c.id ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
