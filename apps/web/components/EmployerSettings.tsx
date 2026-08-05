'use client';

/**
 * Settings: organization info (read-only) + team management. Team actions
 * (invite/remove/promote/demote) are admin-only — hidden here for a member
 * as a UX courtesy, but the real enforcement is server-side (@Roles on
 * OrgMembersController; see apps/api's own comment on that distinction).
 * A member still sees the member list itself (GET /orgs/members is shared),
 * just without the action buttons.
 */
import { useEffect, useState } from 'react';
import { employerApi } from '@/lib/api';

const { api } = employerApi;

interface OrgMe {
  organization: { id: string; name: string };
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

  useEffect(() => {
    api<OrgMe>('/orgs/me').then(setOrg).catch((e) => setError(e.message));
    loadTeam();
  }, []);

  function loadTeam() {
    api<TeamData>('/orgs/members').then(setTeam).catch((e) => setTeamError(e.message));
  }

  const isAdmin = org?.role === 'EMPLOYER_ADMIN';
  const adminCount = team?.members.filter((m) => m.role === 'EMPLOYER_ADMIN').length ?? 0;

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
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginBottom: 24 }}>
          <div>
            <div className="meta" style={{ margin: 0 }}>Organization</div>
            <strong>{org.organization.name}</strong>
          </div>
          <div>
            <div className="meta" style={{ margin: 0 }}>Your role</div>
            <strong>{org.role === 'EMPLOYER_ADMIN' ? 'Admin' : 'Member'}</strong>
          </div>
          <p className="meta" style={{ marginTop: 12 }}>
            Organization details and billing aren&apos;t configurable yet.
          </p>
        </div>
      )}

      <h2>Team</h2>
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
