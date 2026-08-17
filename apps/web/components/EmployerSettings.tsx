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
import { employerApi } from '@/lib/api';

const { api, apiBlob } = employerApi;

interface OrgMe {
  organization: { id: string; name: string; industry: string | null; website: string | null; hasLogo: boolean };
  role: string;
}

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

export default function EmployerSettings() {
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
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [savingOrgInfo, setSavingOrgInfo] = useState(false);
  const [orgInfoError, setOrgInfoError] = useState('');

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
    apiBlob(`/orgs/${org.organization.id}/logo`)
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
  }, [org?.organization.id, org?.organization.hasLogo]);

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
        body: JSON.stringify({ industry: industry.trim() || undefined, website: website.trim() || undefined }),
      });
      setOrg((prev) => (prev ? { ...prev, organization: updated } : prev));
    } catch (e) {
      setOrgInfoError((e as Error).message);
    } finally {
      setSavingOrgInfo(false);
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
          </div>
          <div>
            <div className="meta" style={{ margin: 0 }}>Your role</div>
            <strong>{org.role === 'EMPLOYER_ADMIN' ? 'Admin' : 'Member'}</strong>
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
                <input
                  id="orgIndustry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Healthcare technology"
                />
              </div>
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
                <button onClick={saveOrgInfo} disabled={savingOrgInfo}>
                  {savingOrgInfo ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <p className="meta" style={{ margin: 0 }}>
              {org.organization.industry || 'Industry not set'} · {org.organization.website || 'Website not set'}
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
    </main>
  );
}
