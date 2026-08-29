'use client';

/**
 * Settings: organization info (editable — industry/website/logo) + team
 * management. Both organization edits and every team action
 * (invite/remove/promote/demote) are admin-only — hidden here for a member
 * as a UX courtesy, but the real enforcement is server-side (@Roles on
 * OrgsController.updateMe/uploadLogo/deleteLogo and OrgMembersController;
 * see apps/api's own comment on that distinction). A member still sees the
 * organization info and member list read-only (GET /orgs/me and
 * /orgs/members are shared), just without the edit/action controls.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { employerApi } from '@/lib/api';
import { Badge } from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { formatOrgIndustry, OrgIndustry, ORG_INDUSTRY_OPTIONS } from '@/lib/orgIndustry';

const { api, apiBlob } = employerApi;

type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

interface OrgMe {
  organization: {
    id: string;
    name: string;
    code: string;
    industry: OrgIndustry | null;
    industryOther: string | null;
    website: string | null;
    hasLogo: boolean;
    verificationStatus: VerificationStatus;
    rejectionReason: string | null;
  };
  role: string;
}

const VERIFICATION_BADGE: Record<VerificationStatus, { variant: 'neutral' | 'warning' | 'verified' | 'danger'; label: string }> = {
  UNVERIFIED: { variant: 'neutral', label: 'Not verified' },
  PENDING: { variant: 'warning', label: 'Pending review' },
  VERIFIED: { variant: 'verified', label: 'Verified' },
  REJECTED: { variant: 'danger', label: 'Verification rejected' },
};

interface Member {
  id: string;
  userId: string;
  email: string | null;
  phone: string | null;
  role: 'EMPLOYER_ADMIN' | 'EMPLOYER_MEMBER';
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  status: 'PENDING' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

interface TeamData {
  members: Member[];
  invitations: Invitation[];
  seatLimit: number;
  seatsUsed: number;
  seatsRemaining: number;
}

const ROLE_LABEL: Record<Member['role'], string> = { EMPLOYER_ADMIN: 'Admin', EMPLOYER_MEMBER: 'Member' };

interface DeactivationPreview {
  liveJobCount: number;
  applicantCount: number;
}

export default function EmployerSettings() {
  const router = useRouter();
  const [org, setOrg] = useState<OrgMe>();
  const [team, setTeam] = useState<TeamData>();
  const [error, setError] = useState('');
  const [teamError, setTeamError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Org-info form — seeded from `org` once it loads (below), edited locally
  // until Save. industry/website are independent of the logo section (own
  // save button, own error), matching CandidateAvatar's own upload/preview
  // split from the surrounding profile form on the candidate side.
  const [industry, setIndustry] = useState<OrgIndustry | ''>('');
  const [industryOther, setIndustryOther] = useState('');
  const [website, setWebsite] = useState('');
  const [savingOrgInfo, setSavingOrgInfo] = useState(false);
  const [orgInfoError, setOrgInfoError] = useState('');

  const [submittingVerification, setSubmittingVerification] = useState(false);
  const [verificationError, setVerificationError] = useState('');

  // Deactivation — two-step, same "reveal a confirmation panel, don't just
  // confirm() a raw dialog" shape as /profile/account's delete flow. The
  // preview (concrete counts) is fetched only once the panel opens, not
  // eagerly on page load, since it's meaningless until an admin is
  // actually considering this.
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivatePreview, setDeactivatePreview] = useState<DeactivationPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [deactivateConfirmName, setDeactivateConfirmName] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState('');

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [removingLogo, setRemovingLogo] = useState(false);
  const [logoError, setLogoError] = useState('');
  // Tracks the currently-displayed blob: URL so it can be revoked before
  // creating the next one — same pattern as CandidateAvatar's urlRef.
  const logoUrlRef = useRef<string | null>(null);

  useEffect(() => {
    api<OrgMe>('/orgs/me')
      .then((data) => {
        setOrg(data);
        setIndustry(data.organization.industry ?? '');
        setIndustryOther(data.organization.industryOther ?? '');
        setWebsite(data.organization.website ?? '');
      })
      .catch((e) => setError(e.message));
    loadTeam();
  }, []);

  useEffect(() => {
    if (logoUrlRef.current) {
      URL.revokeObjectURL(logoUrlRef.current);
      logoUrlRef.current = null;
    }
    setLogoUrl(null);
    if (!org?.organization.hasLogo) return;

    let cancelled = false;
    apiBlob('/orgs/me/logo')
      .then((blob) => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        logoUrlRef.current = objectUrl;
        setLogoUrl(objectUrl);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [org?.organization.hasLogo]);

  useEffect(() => () => {
    if (logoUrlRef.current) URL.revokeObjectURL(logoUrlRef.current);
  }, []);

  function loadTeam() {
    api<TeamData>('/orgs/members').then(setTeam).catch((e) => setTeamError(e.message));
  }

  const isAdmin = org?.role === 'EMPLOYER_ADMIN';
  const adminCount = team?.members.filter((m) => m.role === 'EMPLOYER_ADMIN').length ?? 0;

  async function saveOrgInfo() {
    setSavingOrgInfo(true);
    setOrgInfoError('');
    try {
      const updated = await api<OrgMe['organization']>('/orgs/me', {
        method: 'PATCH',
        body: JSON.stringify({
          industry: industry || undefined,
          // Only meaningful (and only sent) when industry is OTHER — same
          // omit-rather-than-clear convention as the candidate role-title
          // form; a stale value left in the DB from a prior OTHER
          // selection is harmless once industry itself has moved on.
          industryOther: industry === 'OTHER' ? industryOther.trim() || undefined : undefined,
          website: website.trim() || undefined,
        }),
      });
      setOrg((prev) => (prev ? { ...prev, organization: updated } : prev));
    } catch (e) {
      setOrgInfoError((e as Error).message);
    } finally {
      setSavingOrgInfo(false);
    }
  }

  async function submitVerification() {
    setSubmittingVerification(true);
    setVerificationError('');
    try {
      const updated = await api<OrgMe['organization']>('/orgs/me/verification/submit', { method: 'POST' });
      setOrg((prev) => (prev ? { ...prev, organization: updated } : prev));
    } catch (e) {
      setVerificationError((e as Error).message);
    } finally {
      setSubmittingVerification(false);
    }
  }

  async function openDeactivate() {
    setDeactivateOpen(true);
    setDeactivateConfirmName('');
    setDeactivateError('');
    setPreviewError('');
    setDeactivatePreview(null);
    try {
      const preview = await api<DeactivationPreview>('/orgs/me/deactivation-preview');
      setDeactivatePreview(preview);
    } catch (e) {
      setPreviewError((e as Error).message);
    }
  }

  async function submitDeactivate() {
    if (!org) return;
    setDeactivating(true);
    setDeactivateError('');
    try {
      await api('/orgs/me/deactivate', {
        method: 'POST',
        body: JSON.stringify({ confirmOrgName: deactivateConfirmName }),
      });
      // The whole org is blocked from here on — every other request this
      // page could make would now 403. Land on the explanation screen
      // rather than trying to keep rendering settings.
      router.replace('/employer/deactivated');
    } catch (e) {
      setDeactivateError((e as Error).message);
      setDeactivating(false);
    }
  }

  async function uploadLogo() {
    if (!logoFile) return;
    setUploadingLogo(true);
    setLogoError('');
    try {
      const body = new FormData();
      body.append('file', logoFile);
      const updated = await api<OrgMe['organization']>('/orgs/me/logo', { method: 'POST', body });
      setOrg((prev) => (prev ? { ...prev, organization: updated } : prev));
      setLogoFile(null);
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function removeLogo() {
    setRemovingLogo(true);
    setLogoError('');
    try {
      const updated = await api<OrgMe['organization']>('/orgs/me/logo', { method: 'DELETE' });
      setOrg((prev) => (prev ? { ...prev, organization: updated } : prev));
    } catch (e) {
      setLogoError((e as Error).message);
    } finally {
      setRemovingLogo(false);
    }
  }

  async function sendInvite() {
    setTeamError('');
    setInviting(true);
    try {
      await api('/orgs/members/invite', { method: 'POST', body: JSON.stringify({ email: inviteEmail.trim() }) });
      setInviteEmail('');
      loadTeam();
    } catch (e) {
      setTeamError((e as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function runAction(id: string, path: string, method: string) {
    setTeamError('');
    setBusyId(id);
    try {
      await api(path, { method });
      loadTeam();
    } catch (e) {
      setTeamError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const removeMember = (id: string) => runAction(id, `/orgs/members/${id}`, 'DELETE');
  const promoteMember = (id: string) => runAction(id, `/orgs/members/${id}/promote`, 'PATCH');
  const demoteMember = (id: string) => runAction(id, `/orgs/members/${id}/demote`, 'PATCH');
  const revokeInvitation = (id: string) => runAction(id, `/orgs/members/invitations/${id}`, 'DELETE');

  const canSendInvite = inviteEmail.trim().length > 0 && !inviting && (team ? team.seatsRemaining > 0 : true);

  return (
    <main className="container-standard">
      <h1>Settings</h1>

      {error && <p className="error">{error}</p>}
      {!error && !org && <p className="meta">Loading…</p>}

      {org && (
        <div id="organisation" className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16, marginBottom: 24 }}>
          <div>
            <div className="meta" style={{ margin: 0 }}>Organization</div>
            <strong>{org.organization.name}</strong>
            <span className="meta" style={{ marginLeft: 8 }}>{org.organization.code}</span>
          </div>
          <div>
            <div className="meta" style={{ margin: 0 }}>Your role</div>
            <strong>{org.role === 'EMPLOYER_ADMIN' ? 'Admin' : 'Member'}</strong>
          </div>

          <div>
            <div className="meta" style={{ margin: 0 }}>Verification</div>
            <div className="row" style={{ margin: '4px 0 0', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Badge variant={VERIFICATION_BADGE[org.organization.verificationStatus].variant}>
                {VERIFICATION_BADGE[org.organization.verificationStatus].label}
              </Badge>
              {isAdmin && (org.organization.verificationStatus === 'UNVERIFIED' || org.organization.verificationStatus === 'REJECTED') && (
                <button onClick={submitVerification} disabled={submittingVerification}>
                  {submittingVerification
                    ? 'Submitting…'
                    : org.organization.verificationStatus === 'REJECTED'
                      ? 'Resubmit for verification'
                      : 'Submit for verification'}
                </button>
              )}
            </div>
            {org.organization.verificationStatus === 'REJECTED' && org.organization.rejectionReason && (
              <p className="error" style={{ margin: '6px 0 0' }}>Reason: {org.organization.rejectionReason}</p>
            )}
            {verificationError && <p className="error" style={{ margin: '6px 0 0' }}>{verificationError}</p>}
          </div>

          <div className="row" style={{ margin: 0, alignItems: 'center', gap: 16 }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div
                aria-hidden="true"
                style={{ width: 64, height: 64, borderRadius: 8, background: 'var(--brand-100)', flexShrink: 0 }}
              />
            )}
            {isAdmin && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="row" style={{ margin: 0, gap: 8, flexWrap: 'wrap' }}>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                  />
                  <button onClick={uploadLogo} disabled={!logoFile || uploadingLogo}>
                    {uploadingLogo ? 'Uploading…' : 'Upload logo'}
                  </button>
                  {org.organization.hasLogo && (
                    <button className="btn-secondary" onClick={removeLogo} disabled={removingLogo}>
                      {removingLogo ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </div>
                {logoError && <p className="error" style={{ margin: 0 }}>{logoError}</p>}
              </div>
            )}
          </div>

          {isAdmin ? (
            <>
              {orgInfoError && <p className="error" style={{ margin: 0 }}>{orgInfoError}</p>}
              <div className="field">
                <label htmlFor="orgIndustry">Industry</label>
                <SearchableSelect
                  id="orgIndustry"
                  options={ORG_INDUSTRY_OPTIONS}
                  value={industry}
                  onSelect={setIndustry}
                  placeholder="Search industries…"
                />
              </div>
              {industry === 'OTHER' && (
                <div className="field">
                  <label htmlFor="orgIndustryOther">Describe your industry</label>
                  <input
                    id="orgIndustryOther"
                    value={industryOther}
                    onChange={(e) => setIndustryOther(e.target.value)}
                    maxLength={160}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="orgWebsite">Website</label>
                <input
                  id="orgWebsite"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  maxLength={255}
                  placeholder="https://example.com"
                />
              </div>
              <div className="row" style={{ margin: 0 }}>
                <button
                  onClick={saveOrgInfo}
                  disabled={savingOrgInfo || (industry === 'OTHER' && !industryOther.trim())}
                >
                  {savingOrgInfo ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              {formatOrgIndustry(org.organization.industry, org.organization.industryOther) ?? 'Industry not set'} ·{' '}
              {org.organization.website || 'Website not set'}
            </p>
          )}

          <p className="meta" style={{ marginTop: 4 }}>Billing isn&apos;t configurable yet.</p>
        </div>
      )}

      <h2 id="team">Team</h2>
      {teamError && <p className="error">{teamError}</p>}
      {!teamError && !team && <p className="meta">Loading…</p>}

      {team && (
        <>
          <p className="meta" style={{ marginTop: -4 }}>
            {team.seatsUsed} of {team.seatLimit} seats used
            {team.seatsRemaining === 0 && ' — at capacity'}.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {team.members.map((m) => {
              const isLastAdmin = m.role === 'EMPLOYER_ADMIN' && adminCount <= 1;
              return (
                <div key={m.id} className="card" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{m.email ?? m.phone}</strong>
                    <div className="meta" style={{ margin: 0 }}>
                      {ROLE_LABEL[m.role]} · joined {new Date(m.joinedAt).toLocaleDateString()}
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="row" style={{ margin: 0, flexWrap: 'wrap' }}>
                      {m.role === 'EMPLOYER_MEMBER' ? (
                        <button onClick={() => promoteMember(m.id)} disabled={busyId === m.id}>
                          Promote to admin
                        </button>
                      ) : (
                        <button
                          className="btn-secondary"
                          onClick={() => demoteMember(m.id)}
                          disabled={busyId === m.id || isLastAdmin}
                          title={isLastAdmin ? 'An organization must always have at least one admin.' : undefined}
                        >
                          Demote to member
                        </button>
                      )}
                      <button
                        className="btn-secondary"
                        onClick={() => removeMember(m.id)}
                        disabled={busyId === m.id || isLastAdmin}
                        title={isLastAdmin ? 'An organization must always have at least one admin.' : undefined}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {team.invitations.length > 0 && (
            <>
              <h3 style={{ marginBottom: 12 }}>Pending invitations</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {team.invitations.map((inv) => (
                  <div key={inv.id} className="card" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <div>
                      <strong>{inv.email}</strong>
                      <div className="meta" style={{ margin: 0 }}>
                        {inv.status === 'EXPIRED'
                          ? 'Expired'
                          : `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    {isAdmin && (
                      <button className="btn-secondary" onClick={() => revokeInvitation(inv.id)} disabled={busyId === inv.id}>
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {isAdmin && (
            <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
              <strong>Invite a team member</strong>
              <p className="meta" style={{ margin: 0 }}>
                {team.seatsRemaining > 0
                  ? `${team.seatsRemaining} seat${team.seatsRemaining === 1 ? '' : 's'} remaining.`
                  : 'No seats remaining — remove a member or revoke a pending invitation to free one up.'}
              </p>
              <div className="row" style={{ margin: 0 }}>
                <input
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={team.seatsRemaining === 0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSendInvite) sendInvite();
                  }}
                  style={{ flex: 1 }}
                />
                <button onClick={sendInvite} disabled={!canSendInvite}>
                  {inviting ? 'Sending…' : 'Send invite'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {org && isAdmin && (
        <div
          className="card"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, borderColor: 'var(--error)', marginTop: 24 }}
        >
          <h2 style={{ marginTop: 0 }}>Deactivate organization</h2>
          <p className="meta" style={{ margin: 0 }}>
            This blocks every team member — not just you — from the employer portal, and unpublishes every live
            job. There is no self-service way to undo this; only MyAmbii support can reactivate an organization.
          </p>

          {!deactivateOpen ? (
            <div className="row" style={{ margin: 0 }}>
              <button className="btn-danger" onClick={openDeactivate}>
                Deactivate organization
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {previewError && <p className="error" style={{ margin: 0 }}>{previewError}</p>}
              {!previewError && !deactivatePreview && <p className="meta" style={{ margin: 0 }}>Checking impact…</p>}
              {deactivatePreview && (
                <p style={{ margin: 0 }}>
                  This will unpublish <strong>{deactivatePreview.liveJobCount}</strong> live job
                  {deactivatePreview.liveJobCount === 1 ? '' : 's'} and notify{' '}
                  <strong>{deactivatePreview.applicantCount}</strong> applicant
                  {deactivatePreview.applicantCount === 1 ? '' : 's'} that their applications are no longer being
                  accepted. Every team member loses portal access immediately.
                  <br />
                  <br />
                  This can only be undone by a platform admin — and even then, the unpublished jobs are{' '}
                  <strong>not</strong> reopened automatically. Applicants will already have been told those roles
                  are closed; reactivating restores portal access only, not the job postings.
                </p>
              )}

              <div className="field">
                <label htmlFor="deactivateConfirmName">
                  Type <strong>{org.organization.name}</strong> to confirm.
                </label>
                <input
                  id="deactivateConfirmName"
                  value={deactivateConfirmName}
                  onChange={(e) => setDeactivateConfirmName(e.target.value)}
                  autoComplete="off"
                />
              </div>

              {deactivateError && <p className="error" style={{ margin: 0 }}>{deactivateError}</p>}

              <div className="row" style={{ margin: 0 }}>
                <button
                  className="btn-danger"
                  onClick={submitDeactivate}
                  disabled={deactivating || !deactivatePreview || deactivateConfirmName !== org.organization.name}
                >
                  {deactivating ? 'Deactivating…' : 'Permanently deactivate'}
                </button>
                <button className="btn-secondary" onClick={() => setDeactivateOpen(false)} disabled={deactivating}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
