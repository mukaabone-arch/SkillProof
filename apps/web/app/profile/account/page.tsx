'use client';

/**
 * Account settings: deactivate (reversible) and delete (permanent). Kept as
 * its own page off /profile rather than a section on it — both flows are
 * multi-step (reason capture, then a distinct confirmation step) and don't
 * belong competing for space with the profile form candidates edit far more
 * often. Linked from /profile, not hidden — see the "must not be
 * obstructed" requirement on delete specifically.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, logout, type ApiError } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { Badge, Card, ErrorState, LoadingState } from '@/components/ui';
import { useRequireAuth } from '@/lib/useRequireAuth';

type ReasonCategory =
  | 'FOUND_JOB_SKILLPROOF'
  | 'FOUND_JOB_ELSEWHERE'
  | 'NOT_FINDING_ROLES'
  | 'TOO_MANY_EMAILS'
  | 'PRIVACY_CONCERNS'
  | 'OTHER';

const REASON_OPTIONS: { value: ReasonCategory; label: string }[] = [
  { value: 'FOUND_JOB_SKILLPROOF', label: 'Found a job through Myambii' },
  { value: 'FOUND_JOB_ELSEWHERE', label: 'Found a job elsewhere' },
  { value: 'NOT_FINDING_ROLES', label: 'Not finding relevant roles' },
  { value: 'TOO_MANY_EMAILS', label: 'Too many emails' },
  { value: 'PRIVACY_CONCERNS', label: 'Privacy concerns' },
  { value: 'OTHER', label: 'Other' },
];

interface AccountStatus {
  deactivated: boolean;
  deactivatedAt: string | null;
}

type ExportStatus = 'REQUESTED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';

interface ExportRequestRow {
  id: string;
  status: ExportStatus;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  fileSizeBytes: number | null;
}

const EXPORT_STATUS_BADGE: Record<ExportStatus, { variant: 'neutral' | 'warning' | 'verified' | 'danger'; label: string }> = {
  REQUESTED: { variant: 'neutral', label: 'Queued' },
  PROCESSING: { variant: 'warning', label: 'Processing' },
  READY: { variant: 'verified', label: 'Ready' },
  FAILED: { variant: 'danger', label: 'Failed' },
  EXPIRED: { variant: 'neutral', label: 'Expired' },
};

function formatBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * "Download my data" — same family of rights as deactivate/delete below,
 * so it lives on the same page. Shown regardless of deactivation status
 * (unlike the deactivate/delete cards themselves): a portability request
 * shouldn't be gated by a reversible state like deactivation.
 */
function ExportsCard() {
  const [exportsList, setExportsList] = useState<ExportRequestRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [downloadingId, setDownloadingId] = useState('');
  const [downloadError, setDownloadError] = useState('');

  function load() {
    api<ExportRequestRow[]>('/account/exports')
      .then((rows) => {
        setExportsList(rows);
        setLoadError('');
      })
      .catch((e) => setLoadError((e as Error).message));
  }

  useEffect(() => {
    load();
    // Poll while anything is still in flight, so a REQUESTED/PROCESSING row
    // flips to READY without the candidate having to reload the page.
    const interval = setInterval(() => {
      setExportsList((current) => {
        if (current?.some((r) => r.status === 'REQUESTED' || r.status === 'PROCESSING')) load();
        return current;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function submitRequest() {
    setRequesting(true);
    setRequestError('');
    try {
      await api('/account/exports', { method: 'POST' });
      load();
    } catch (e) {
      setRequestError((e as ApiError).message);
    } finally {
      setRequesting(false);
    }
  }

  async function download(row: ExportRequestRow) {
    setDownloadingId(row.id);
    setDownloadError('');
    try {
      // The API hands back a short-lived, single-use presigned URL rather
      // than the file's bytes — navigate straight to it; Content-Disposition
      // on that response (set server-side) triggers the browser's save-to-disk.
      const { url } = await api<{ url: string }>(`/account/exports/${row.id}/download`);
      const a = document.createElement('a');
      a.href = url;
      a.click();
    } catch (e) {
      setDownloadError((e as ApiError).message);
    } finally {
      setDownloadingId('');
    }
  }

  const canRequest = !exportsList?.some((r) => r.status === 'REQUESTED' || r.status === 'PROCESSING');

  return (
    <Card elevated style={{ marginBottom: 32 }}>
      <h2 style={{ marginTop: 0 }}>Download my data</h2>
      <p>
        A complete, machine-readable copy of your personal data on Myambii — profile, badges, assessment and
        discussion history, applications, and more. Generated in the background; you&apos;ll get an email when
        it&apos;s ready, and the download link expires after 7 days.
      </p>

      {loadError && <ErrorState message={loadError} />}
      {!exportsList && !loadError && <LoadingState />}

      {exportsList && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {exportsList.length === 0 ? (
            <p className="meta" style={{ margin: 0 }}>No export requested yet.</p>
          ) : (
            exportsList.map((row) => (
              <div
                key={row.id}
                className="row"
                style={{ justifyContent: 'space-between', margin: 0, alignItems: 'center' }}
              >
                <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
                  <Badge variant={EXPORT_STATUS_BADGE[row.status].variant}>{EXPORT_STATUS_BADGE[row.status].label}</Badge>
                  <span className="meta" style={{ margin: 0 }}>
                    Requested {new Date(row.requestedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                    {row.fileSizeBytes != null && ` · ${formatBytes(row.fileSizeBytes)}`}
                  </span>
                </div>
                {row.status === 'READY' && (
                  <button
                    className="btn-secondary"
                    onClick={() => download(row)}
                    disabled={downloadingId === row.id}
                  >
                    {downloadingId === row.id ? 'Downloading…' : 'Download'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {downloadError && <ErrorState message={downloadError} />}
      {requestError && <ErrorState message={requestError} />}

      <button onClick={submitRequest} disabled={requesting || !canRequest}>
        {requesting ? 'Requesting…' : canRequest ? 'Request export' : 'Export in progress…'}
      </button>
    </Card>
  );
}

interface MeIdentifiers {
  phone: string | null;
  email: string | null;
}

/**
 * Login methods: shows the phone and email on this account and lets the
 * candidate ADD whichever is missing, OTP-verified, onto the SAME account
 * (POST /auth/link/{phone,email}/request|verify). This is what keeps phone
 * and email as one account instead of two with split badges — see
 * AuthService's linking methods.
 */
function LoginMethodsCard() {
  const [me, setMe] = useState<MeIdentifiers | null>(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState<'phone' | 'email' | null>(null);
  const [value, setValue] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'input' | 'otp'>('input');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function load() {
    api<MeIdentifiers>('/users/me')
      .then((u) => setMe({ phone: u.phone, email: u.email }))
      .catch((e) => setLoadError((e as Error).message));
  }
  useEffect(() => {
    load();
  }, []);

  function startAdd(method: 'phone' | 'email') {
    setAdding(method);
    setValue('');
    setOtp('');
    setStage('input');
    setError('');
    setSuccess('');
  }
  function cancel() {
    setAdding(null);
    setValue('');
    setOtp('');
    setStage('input');
    setError('');
  }

  async function sendCode() {
    if (!adding) return;
    setError('');
    setBusy(true);
    try {
      await api(`/auth/link/${adding}/request`, { method: 'POST', body: JSON.stringify({ [adding]: value.trim() }) });
      setStage('otp');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!adding) return;
    setError('');
    setBusy(true);
    try {
      await api(`/auth/link/${adding}/verify`, {
        method: 'POST',
        body: JSON.stringify({ [adding]: value.trim(), otp }),
      });
      setSuccess(adding === 'phone' ? 'Phone number added to your account.' : 'Email added to your account.');
      setAdding(null);
      setOtp('');
      setStage('input');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card elevated style={{ marginBottom: 32 }}>
      <h2 style={{ marginTop: 0 }}>Login methods</h2>
      <p>
        Sign in with either your email or your phone. Adding the one you&apos;re missing keeps everything on this one
        account — badges, history and all — instead of creating a second one.
      </p>

      {loadError && <ErrorState message={loadError} />}
      {!me && !loadError && <LoadingState />}
      {success && <p className="ok">{success}</p>}

      {me && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(['email', 'phone'] as const).map((m) => {
            const current = me[m];
            return (
              <div key={m} className="row" style={{ justifyContent: 'space-between', margin: 0, alignItems: 'center' }}>
                <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
                  <Badge variant={current ? 'verified' : 'neutral'}>{m === 'email' ? 'Email' : 'Phone'}</Badge>
                  <span className="meta" style={{ margin: 0 }}>{current ?? 'Not added'}</span>
                </div>
                {!current && adding !== m && (
                  <button className="btn-secondary" onClick={() => startAdd(m)}>
                    Add {m === 'email' ? 'email' : 'phone'}
                  </button>
                )}
              </div>
            );
          })}

          {adding && (
            <div className="field" style={{ marginTop: 4 }}>
              {stage === 'input' ? (
                <>
                  <label htmlFor="link-value">{adding === 'email' ? 'Email' : 'Phone number'}</label>
                  <input
                    id="link-value"
                    type={adding === 'email' ? 'email' : 'tel'}
                    inputMode={adding === 'email' ? 'email' : 'tel'}
                    autoComplete={adding === 'email' ? 'email' : 'tel'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={adding === 'email' ? 'you@example.com' : '+91 98765 43210'}
                  />
                  <div className="row" style={{ margin: '10px 0 0', gap: 8 }}>
                    <button onClick={sendCode} disabled={busy || value.trim().length === 0}>
                      {busy ? 'Sending…' : 'Send code'}
                    </button>
                    <button type="button" className="btn-link" onClick={cancel} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label htmlFor="link-otp">Enter the 6-digit code sent to {value.trim()}</label>
                  <input
                    id="link-otp"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <div className="row" style={{ margin: '10px 0 0', gap: 8 }}>
                    <button onClick={verify} disabled={busy || otp.length !== 6}>
                      {busy ? 'Verifying…' : `Verify and add ${adding === 'email' ? 'email' : 'phone'}`}
                    </button>
                    <button type="button" className="btn-link" onClick={cancel} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {error && <ErrorState message={error} />}
        </div>
      )}
    </Card>
  );
}

/**
 * Shared by both flows below — a single-select plus optional free text,
 * always skippable. Neither field is ever required to submit; see
 * ReasonPicker's own callers for why that has to hold regardless of which
 * action is being confirmed.
 */
function ReasonPicker({
  reason,
  onReasonChange,
  reasonText,
  onReasonTextChange,
}: {
  reason: ReasonCategory | '';
  onReasonChange: (r: ReasonCategory | '') => void;
  reasonText: string;
  onReasonTextChange: (t: string) => void;
}) {
  return (
    <div className="field">
      <label>Mind telling us why? (optional)</label>
      <select value={reason} onChange={(e) => onReasonChange(e.target.value as ReasonCategory | '')}>
        <option value="">Prefer not to say</option>
        {REASON_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <textarea
        rows={2}
        value={reasonText}
        onChange={(e) => onReasonTextChange(e.target.value)}
        placeholder="Anything else you'd like to add (optional)"
        style={{ marginTop: 8 }}
      />
      <p className="meta" style={{ margin: '4px 0 0' }}>
        This is just for our own understanding — answering isn&apos;t required either way.
      </p>
    </div>
  );
}

export default function AccountSettingsPage() {
  const ready = useRequireAuth();
  const router = useRouter();

  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [loadError, setLoadError] = useState('');

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState<ReasonCategory | ''>('');
  const [deactivateReasonText, setDeactivateReasonText] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState('');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState<ReasonCategory | ''>('');
  const [deleteReasonText, setDeleteReasonText] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!ready) return;
    api<AccountStatus>('/account/status')
      .then(setStatus)
      .catch((e) => setLoadError((e as Error).message));
  }, [ready]);

  async function submitDeactivate() {
    setDeactivating(true);
    setDeactivateError('');
    try {
      await api('/account/deactivate', {
        method: 'POST',
        body: JSON.stringify({
          reasonCategory: deactivateReason || undefined,
          reasonText: deactivateReasonText.trim() || undefined,
        }),
      });
      await logout();
      router.replace('/candidate');
    } catch (e) {
      setDeactivateError((e as ApiError).message);
      setDeactivating(false);
    }
  }

  async function submitDelete() {
    setDeleting(true);
    setDeleteError('');
    try {
      await api('/account/delete', {
        method: 'POST',
        body: JSON.stringify({
          confirmation,
          reasonCategory: deleteReason || undefined,
          reasonText: deleteReasonText.trim() || undefined,
        }),
      });
      await logout();
      router.replace('/candidate');
    } catch (e) {
      setDeleteError((e as ApiError).message);
      setDeleting(false);
    }
  }

  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main className="container-reading">
        <h1>Account</h1>
        <p>
          <Link href="/profile">← Back to profile</Link>
        </p>

        {loadError && <ErrorState message={loadError} />}
        {!status && !loadError && <LoadingState />}

        <LoginMethodsCard />

        {status && <ExportsCard />}

        {status?.deactivated && (
          <Card style={{ marginBottom: 24 }}>
            <p style={{ margin: 0 }}>
              Your account is currently deactivated. Reactivate it from the sign-in screen any time — just sign back
              in and you&apos;ll be offered the option.
            </p>
          </Card>
        )}

        {status && !status.deactivated && (
          <>
            <Card elevated style={{ marginBottom: 32 }}>
              <h2 style={{ marginTop: 0 }}>Deactivate my account</h2>
              <p>
                Your profile is hidden from employer search and matching, you won&apos;t appear in new match results
                or get newly shortlisted or invited, and all notification emails stop. Everything else about your
                account — your profile, badges, applications, and history — is kept exactly as it is. Sign back in
                any time to reactivate.
              </p>

              {!deactivateOpen ? (
                <button onClick={() => setDeactivateOpen(true)}>Deactivate account</button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ReasonPicker
                    reason={deactivateReason}
                    onReasonChange={setDeactivateReason}
                    reasonText={deactivateReasonText}
                    onReasonTextChange={setDeactivateReasonText}
                  />
                  {deactivateError && <ErrorState message={deactivateError} />}
                  <div className="row" style={{ margin: 0 }}>
                    <button onClick={submitDeactivate} disabled={deactivating}>
                      {deactivating ? 'Deactivating…' : 'Confirm deactivation'}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setDeactivateOpen(false)}
                      disabled={deactivating}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Card>

            <Card style={{ borderColor: 'var(--error)' }}>
              <h2 style={{ marginTop: 0 }}>Delete my account</h2>
              <p>
                This permanently removes your personal data — name, email, phone, photo, resume, and profile
                details. It cannot be undone. Any verified skill badge you&apos;ve earned stays independently
                verifiable to anyone who already has the certificate link, shown without your name attached.
                Employer records that legitimately belong to them (that you applied, were shortlisted, or
                interviewed) are kept, anonymised — deleting your account doesn&apos;t create holes in someone
                else&apos;s hiring history.
              </p>

              {!deleteOpen ? (
                <button className="btn-danger" onClick={() => setDeleteOpen(true)}>Delete account</button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ReasonPicker
                    reason={deleteReason}
                    onReasonChange={setDeleteReason}
                    reasonText={deleteReasonText}
                    onReasonTextChange={setDeleteReasonText}
                  />
                  <div className="field">
                    <label htmlFor="deleteConfirmation">
                      This can&apos;t be undone. Type <strong>DELETE</strong> to confirm.
                    </label>
                    <input
                      id="deleteConfirmation"
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      placeholder="DELETE"
                      autoComplete="off"
                    />
                  </div>
                  {deleteError && <ErrorState message={deleteError} />}
                  <div className="row" style={{ margin: 0 }}>
                    <button
                      className="btn-danger"
                      onClick={submitDelete}
                      disabled={deleting || confirmation !== 'DELETE'}
                    >
                      {deleting ? 'Deleting…' : 'Permanently delete my account'}
                    </button>
                    <button className="btn-secondary" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </>
  );
}
