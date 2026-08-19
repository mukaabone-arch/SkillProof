'use client';

/**
 * Billing profile detail — view/edit/soft-delete. Phase 1 only: no
 * transaction list or actions here yet (that's Phase 2 — GET
 * /admin/billing-profiles/:id/transactions and friends are already live on
 * the API but deliberately not wired up on this page yet).
 *
 * Owner (candidateId/organizationId) is never editable here — a billing
 * profile's owner is fixed at creation (see the API's own CHECK
 * constraint); this page only ever PATCHes the profile fields themselves.
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { LoadingState } from '@/components/ui';
import BillingProfileForm, {
  BillingProfileFormValues,
  billingProfileFormToPayload,
  isGstinValid,
} from '@/components/admin/BillingProfileForm';

interface BillingProfile {
  id: string;
  candidateId: string | null;
  organizationId: string | null;
  legalEntityName: string;
  billingEmail: string;
  billingPhone: string | null;
  gstin: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  gstStateCode: string | null;
  postalCode: string;
  country: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function toForm(p: BillingProfile): BillingProfileFormValues {
  return {
    legalEntityName: p.legalEntityName,
    billingEmail: p.billingEmail,
    billingPhone: p.billingPhone ?? '',
    gstin: p.gstin ?? '',
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2 ?? '',
    city: p.city,
    state: p.state,
    gstStateCode: p.gstStateCode ?? '',
    postalCode: p.postalCode,
    country: p.country,
  };
}

export default function AdminBillingProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'forbidden' | 'not_found' | 'ok'>('loading');
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [form, setForm] = useState<BillingProfileFormValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!getToken()) {
      setStatus('forbidden');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function load() {
    api<BillingProfile>(`/admin/billing-profiles/${id}`)
      .then((p) => {
        setProfile(p);
        setForm(toForm(p));
        setStatus('ok');
      })
      .catch((e) => {
        const statusCode = (e.body as { statusCode?: number } | undefined)?.statusCode;
        setStatus(statusCode === 404 ? 'not_found' : 'forbidden');
      });
  }

  async function save() {
    if (!form) return;
    if (!isGstinValid(form.gstin)) {
      setSaveError('Fix the GSTIN before saving.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const updated = await api<BillingProfile>(`/admin/billing-profiles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(billingProfileFormToPayload(form)),
      });
      setProfile(updated);
      setForm(toForm(updated));
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function softDelete() {
    if (!confirm('Delete this billing profile? Its transaction history is kept.')) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const updated = await api<BillingProfile>(`/admin/billing-profiles/${id}`, { method: 'DELETE' });
      setProfile(updated);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  if (status === 'loading') {
    return (
      <main className="hub">
        <LoadingState />
      </main>
    );
  }

  if (status === 'forbidden') {
    return (
      <main className="hub">
        <p className="error">Admins only — log in with a PLATFORM_ADMIN account to manage billing.</p>
      </main>
    );
  }

  if (status === 'not_found' || !profile || !form) {
    return (
      <main className="hub">
        <p className="error">Billing profile not found.</p>
        <Link href="/admin/billing">← Back to Billing</Link>
      </main>
    );
  }

  const isDeleted = profile.deletedAt !== null;

  return (
    <main className="hub">
      <p><Link href="/admin/billing">← Back to Billing</Link></p>
      <h1>{profile.legalEntityName}</h1>
      <p className="hub-subhead">
        {profile.candidateId ? 'Candidate' : 'Organisation'} · owner id {(profile.candidateId ?? profile.organizationId)!.slice(0, 8)}
        {' · created '}{new Date(profile.createdAt).toLocaleDateString()}
      </p>

      {isDeleted && (
        <p className="error">
          Deleted {new Date(profile.deletedAt!).toLocaleString()} — fields are read-only. Transaction history is unaffected.
        </p>
      )}

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, marginTop: 8 }}>
        {saveError && <p className="error">{saveError}</p>}
        <fieldset disabled={isDeleted} style={{ border: 'none', padding: 0, margin: 0 }}>
          <BillingProfileForm values={form} onChange={setForm} requireCore />
        </fieldset>
        {!isDeleted && (
          <div className="row" style={{ margin: 0 }}>
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        )}
      </div>

      {!isDeleted && (
        <div style={{ marginTop: 24 }}>
          {deleteError && <p className="error">{deleteError}</p>}
          <button className="btn-danger" onClick={softDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete billing profile'}
          </button>
        </div>
      )}
    </main>
  );
}
