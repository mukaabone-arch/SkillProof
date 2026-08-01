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
import { Card, ErrorState, LoadingState } from '@/components/ui';
import { useRequireAuth } from '@/lib/useRequireAuth';

type ReasonCategory =
  | 'FOUND_JOB_SKILLPROOF'
  | 'FOUND_JOB_ELSEWHERE'
  | 'NOT_FINDING_ROLES'
  | 'TOO_MANY_EMAILS'
  | 'PRIVACY_CONCERNS'
  | 'OTHER';

const REASON_OPTIONS: { value: ReasonCategory; label: string }[] = [
  { value: 'FOUND_JOB_SKILLPROOF', label: 'Found a job through SkillProof' },
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
      router.replace('/');
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
      router.replace('/');
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
