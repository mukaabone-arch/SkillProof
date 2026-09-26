'use client';

/**
 * Billing — entry point. Two ways in, since a billing profile's own id is a
 * UUID no admin would ever have memorized and there's no candidate/org
 * directory admin view yet (still "Soon" on the console roadmap):
 *   1. The list below (GET /admin/billing-profiles, added alongside this
 *      page — see BillingProfilesService.list's own doc comment for why).
 *   2. Create a new one, by pasting the owning candidate/org's id directly.
 * "Open by billing-profile id" stays available as a secondary path (e.g. a
 * link shared elsewhere) but is never the only way to reach a profile.
 * Access is gated by the backend (RolesGuard) — this page just probes GET
 * /admin/billing-profiles and shows an "admins only" message on a 403,
 * same pattern as every other page in this console.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { EmptyState, LoadingState } from '@/components/ui';
import BillingProfileForm, {
  BillingProfileFormValues,
  EMPTY_BILLING_PROFILE_FORM,
  billingProfileFormToPayload,
  isGstinValid,
} from '@/components/admin/BillingProfileForm';

interface BillingProfileRow {
  id: string;
  candidateId: string | null;
  organizationId: string | null;
  legalEntityName: string;
  createdAt: string;
  candidateProfile: { fullName: string | null } | null;
  organization: { name: string | null } | null;
}

type OwnerType = 'CANDIDATE' | 'ORGANIZATION';

function ownerLabel(row: BillingProfileRow): string {
  if (row.candidateId) return row.candidateProfile?.fullName || `Candidate ${row.candidateId.slice(0, 8)}`;
  return row.organization?.name || `Organisation ${row.organizationId!.slice(0, 8)}`;
}

export default function AdminBillingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'ok'>('loading');
  const [rows, setRows] = useState<BillingProfileRow[]>([]);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [ownerType, setOwnerType] = useState<OwnerType>('CANDIDATE');
  const [ownerId, setOwnerId] = useState('');
  const [form, setForm] = useState<BillingProfileFormValues>(EMPTY_BILLING_PROFILE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [openId, setOpenId] = useState('');

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
  }, []);

  function load() {
    api<BillingProfileRow[]>('/admin/billing-profiles')
      .then((r) => {
        setRows(r);
        setStatus('ok');
      })
      .catch((e) => {
        setError(e.message);
        setStatus('forbidden');
      });
  }

  async function createProfile() {
    if (!ownerId.trim()) {
      setCreateError('Enter the candidate or organisation id.');
      return;
    }
    if (!form.legalEntityName.trim() || !form.billingEmail.trim() || !form.addressLine1.trim() || !form.city.trim() || !form.state.trim() || !form.postalCode.trim()) {
      setCreateError('Legal entity name, billing email, and address (line 1, city, state, postal code) are required.');
      return;
    }
    if (!isGstinValid(form.gstin)) {
      setCreateError('Fix the GSTIN before saving.');
      return;
    }

    setCreating(true);
    setCreateError('');
    try {
      const path =
        ownerType === 'CANDIDATE'
          ? `/admin/candidates/${ownerId.trim()}/billing-profile`
          : `/admin/orgs/${ownerId.trim()}/billing-profile`;
      const created = await api<{ id: string }>(path, {
        method: 'POST',
        body: JSON.stringify(billingProfileFormToPayload(form)),
      });
      router.push(`/admin/billing/profiles/${created.id}`);
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function openById() {
    if (!openId.trim()) return;
    router.push(`/admin/billing/profiles/${openId.trim()}`);
  }

  if (status === 'loading') {
    return (
      <main className="hub">
        <h1>Billing</h1>
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <h1>Billing</h1>
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to manage billing.</p>
      </main>
    );
  }

  return (
    <main className="hub">
      <h1>Billing</h1>
      <p className="hub-subhead">Billing profiles for candidates and organisations, and their transaction history.</p>
      {error && <p className="error">{error}</p>}

      <div className="row" style={{ justifyContent: 'space-between', margin: '0 0 16px' }}>
        <div className="field" style={{ margin: 0, maxWidth: 320 }}>
          <label htmlFor="openById">Open by billing-profile id</label>
          <div className="row" style={{ margin: 0 }}>
            <input id="openById" value={openId} onChange={(e) => setOpenId(e.target.value)} placeholder="Paste an id…" />
            <button className="btn-secondary" onClick={openById} disabled={!openId.trim()}>Open</button>
          </div>
        </div>
        <button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ New billing profile'}</button>
      </div>

      {showCreate && (
        <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, marginBottom: 24 }}>
          <h2 style={{ margin: 0 }}>New billing profile</h2>
          {createError && <p className="error">{createError}</p>}

          <div className="row" style={{ margin: 0 }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="ownerType">Belongs to</label>
              <select id="ownerType" value={ownerType} onChange={(e) => setOwnerType(e.target.value as OwnerType)}>
                <option value="CANDIDATE">Candidate</option>
                <option value="ORGANIZATION">Organisation</option>
              </select>
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="ownerId">{ownerType === 'CANDIDATE' ? 'Candidate profile id' : 'Organisation id'}</label>
              <input id="ownerId" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="Paste an id…" />
            </div>
          </div>

          <BillingProfileForm values={form} onChange={setForm} requireCore />

          <div className="row" style={{ margin: 0 }}>
            <button onClick={createProfile} disabled={creating}>{creating ? 'Creating…' : 'Create billing profile'}</button>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 8 }}>All billing profiles</h2>
      {rows.length === 0 ? (
        <EmptyState message="No billing profiles yet — create one above." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row) => (
            <Link key={row.id} href={`/admin/billing/profiles/${row.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>{row.legalEntityName}</strong>
                  <div className="meta">
                    {row.candidateId ? 'Candidate' : 'Organisation'} · {ownerLabel(row)}
                  </div>
                </div>
                <span className="meta" style={{ margin: 0 }}>{new Date(row.createdAt).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
