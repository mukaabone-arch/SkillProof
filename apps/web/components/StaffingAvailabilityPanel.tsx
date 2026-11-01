'use client';

/**
 * Candidate opt-in + availability for staffing companies (GET/PUT
 * /staffing/me/availability). Off by default. While on, verified staffing
 * companies can find the candidate by verified skills and availability —
 * anonymised: no name, photo, headline or contact details until the
 * candidate accepts one of their requests. Availability older than
 * `freshDays` stops showing in search until confirmed again.
 */
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorState } from '@/components/ui';
import CollapsibleSection from '@/components/CollapsibleSection';
import {
  AVAILABILITY_LABEL,
  AvailabilityStatus,
  RATE_UNIT_LABEL,
  RateUnit,
  WORK_TYPE_LABEL,
  WORK_TYPES,
  WorkType,
  daysAgo,
  formatAvailability,
} from '@/lib/staffing';

interface Availability {
  openToStaffing: boolean;
  availabilityStatus: AvailabilityStatus | null;
  availableFrom: string | null;
  noticePeriodDays: number | null;
  workTypes: WorkType[];
  expectedRateMinInr: number | null;
  expectedRateMaxInr: number | null;
  expectedRateUnit: RateUnit | null;
  availabilityConfirmedAt: string | null;
  fresh: boolean;
  freshDays: number;
}

interface Block {
  orgId: string;
  orgName: string;
}

const numOrUndef = (s: string) => (s.trim() === '' ? undefined : Number(s));

export default function StaffingAvailabilityPanel() {
  const [a, setA] = useState<Availability | null>(null);
  const [form, setForm] = useState({
    openToStaffing: false,
    availabilityStatus: '' as AvailabilityStatus | '',
    availableFrom: '',
    noticePeriodDays: '',
    workTypes: [] as WorkType[],
    rateMin: '',
    rateMax: '',
    rateUnit: '' as RateUnit | '',
  });
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  function load(data: Availability) {
    setA(data);
    setForm({
      openToStaffing: data.openToStaffing,
      availabilityStatus: data.availabilityStatus ?? '',
      availableFrom: data.availableFrom ? data.availableFrom.slice(0, 10) : '',
      noticePeriodDays: data.noticePeriodDays != null ? String(data.noticePeriodDays) : '',
      workTypes: data.workTypes,
      rateMin: data.expectedRateMinInr != null ? String(data.expectedRateMinInr) : '',
      rateMax: data.expectedRateMaxInr != null ? String(data.expectedRateMaxInr) : '',
      rateUnit: data.expectedRateUnit ?? '',
    });
  }

  useEffect(() => {
    api<Availability>('/staffing/me/availability').then(load).catch((e) => setError((e as Error).message));
    api<Block[]>('/staffing/me/blocks').then(setBlocks).catch(() => undefined);
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const data = await api<Availability>('/staffing/me/availability', {
        method: 'PUT',
        body: JSON.stringify({
          openToStaffing: form.openToStaffing,
          availabilityStatus: form.availabilityStatus || undefined,
          availableFrom: form.availabilityStatus === 'AVAILABLE_FROM' && form.availableFrom ? form.availableFrom : undefined,
          noticePeriodDays: form.availabilityStatus === 'NOTICE_PERIOD' ? numOrUndef(form.noticePeriodDays) : undefined,
          workTypes: form.workTypes,
          expectedRateMinInr: numOrUndef(form.rateMin),
          expectedRateMaxInr: numOrUndef(form.rateMax),
          expectedRateUnit: form.rateUnit || undefined,
        }),
      });
      load(data);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    setError('');
    try {
      load(await api<Availability>('/staffing/me/availability/confirm', { method: 'POST' }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function unblock(orgId: string) {
    try {
      await api(`/staffing/me/blocks/${orgId}`, { method: 'DELETE' });
      setBlocks((b) => b.filter((x) => x.orgId !== orgId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const status = !a
    ? undefined
    : !a.openToStaffing
      ? 'Off'
      : a.fresh
        ? `On · ${formatAvailability(a)}`
        : 'On · needs confirming';

  const toggleWorkType = (w: WorkType) =>
    setForm((f) => ({ ...f, workTypes: f.workTypes.includes(w) ? f.workTypes.filter((x) => x !== w) : [...f.workTypes, w] }));

  return (
    <CollapsibleSection id="staffing" title="Recruiters" status={status}>
      <p>
        Let verified recruiters find you for client roles. They see your verified skills,
        experience, city and availability — <strong>not</strong> your name, photo or contact details. Those are shared only
        with a company whose request you accept.
      </p>
      {error && <ErrorState message={error} />}

      {a && (
        <>
          {a.openToStaffing && !a.fresh && (
            <div className="staffing-stale">
              <span>
                Your availability was last confirmed {daysAgo(a.availabilityConfirmedAt) ?? '–'} days ago, so recruiters
                can&apos;t see you right now.
              </span>
              <button type="button" onClick={confirm}>Still accurate — confirm</button>
            </div>
          )}

          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.openToStaffing}
                onChange={(e) => setForm({ ...form, openToStaffing: e.target.checked })}
              />
              Open to recruiters
            </label>
          </div>

          {form.openToStaffing && (
            <>
              <div className="field">
                <label htmlFor="availabilityStatus">Availability</label>
                <select
                  id="availabilityStatus"
                  value={form.availabilityStatus}
                  onChange={(e) => setForm({ ...form, availabilityStatus: e.target.value as AvailabilityStatus })}
                >
                  <option value="">Choose…</option>
                  {(Object.keys(AVAILABILITY_LABEL) as AvailabilityStatus[]).map((s) => (
                    <option key={s} value={s}>{AVAILABILITY_LABEL[s]}</option>
                  ))}
                </select>
              </div>
              {form.availabilityStatus === 'AVAILABLE_FROM' && (
                <div className="field">
                  <label htmlFor="availableFrom">Available from</label>
                  <input id="availableFrom" type="date" value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} />
                </div>
              )}
              {form.availabilityStatus === 'NOTICE_PERIOD' && (
                <div className="field">
                  <label htmlFor="noticePeriodDays">Notice period (days)</label>
                  <input
                    id="noticePeriodDays"
                    type="number"
                    min={0}
                    max={365}
                    value={form.noticePeriodDays}
                    onChange={(e) => setForm({ ...form, noticePeriodDays: e.target.value })}
                  />
                </div>
              )}

              <div className="field">
                <label>Type of work</label>
                <div className="staffing-checks">
                  {WORK_TYPES.map((w) => (
                    <label key={w}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={form.workTypes.includes(w)} onChange={() => toggleWorkType(w)} />
                      {WORK_TYPE_LABEL[w]}
                    </label>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Expected pay (optional, in ₹)</label>
                <div className="staffing-rate">
                  <input type="number" min={0} placeholder="Min" value={form.rateMin} onChange={(e) => setForm({ ...form, rateMin: e.target.value })} />
                  <input type="number" min={0} placeholder="Max" value={form.rateMax} onChange={(e) => setForm({ ...form, rateMax: e.target.value })} />
                  <select value={form.rateUnit} onChange={(e) => setForm({ ...form, rateUnit: e.target.value as RateUnit })}>
                    <option value="">Per…</option>
                    {(Object.keys(RATE_UNIT_LABEL) as RateUnit[]).map((u) => (
                      <option key={u} value={u}>{RATE_UNIT_LABEL[u]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="row">
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            {saved && <p className="ok" style={{ margin: 0 }}>✓ Saved</p>}
          </div>
          {form.openToStaffing && (
            <p className="meta" style={{ margin: 0 }}>
              We&apos;ll ask you to confirm this every {a.freshDays} days so companies only see people who are really available.
            </p>
          )}

          {blocks.length > 0 && (
            <div className="field" style={{ marginTop: 16 }}>
              <label>Companies you&apos;ve blocked</label>
              {blocks.map((b) => (
                <div key={b.orgId} className="row" style={{ margin: 0, justifyContent: 'space-between' }}>
                  <span>{b.orgName}</span>
                  <button type="button" className="btn-link" onClick={() => unblock(b.orgId)}>Unblock</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}
