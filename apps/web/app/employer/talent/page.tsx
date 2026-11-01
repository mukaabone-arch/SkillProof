'use client';

/**
 * Staffing portal: Find talent (GET /staffing/candidates). Only candidates
 * who opted in, confirmed their availability in the last 30 days, and have
 * at least one verified skill — shown anonymised (a C-XXXXXX reference,
 * verified skills/levels, experience, city, availability, expected pay).
 * "Check availability" sends one request for one role; contact details
 * appear under Availability requests once the candidate says yes.
 */
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import {
  AvailabilityStatus,
  RATE_UNIT_LABEL,
  REQUEST_STATUS_LABEL,
  ROLE_TITLE_LABEL,
  RateUnit,
  RequestStatus,
  WORK_TYPE_LABEL,
  WORK_TYPES,
  WorkType,
  daysAgo,
  formatAvailability,
  formatRate,
} from '@/lib/staffing';

const { api } = employerApi;

interface Skill { id: string; name: string }
interface Domain { id: string; name: string; skills: Skill[] }

interface TalentCard {
  candidateId: string;
  ref: string;
  roleTitle: string | null;
  yearsOfExp: number | null;
  aiYearsOfExp: number | null;
  location: string | null;
  openToRemote: boolean;
  availabilityStatus: AvailabilityStatus | null;
  availableFrom: string | null;
  noticePeriodDays: number | null;
  workTypes: WorkType[];
  expectedRateMinInr: number | null;
  expectedRateMaxInr: number | null;
  expectedRateUnit: RateUnit | null;
  availabilityConfirmedAt: string | null;
  verifiedSkills: { skillId: string; skillName: string; level: string }[];
  lastRequest: { id: string; status: RequestStatus } | null;
}

const EMPTY_REQUEST = {
  roleTitle: '',
  summary: '',
  workType: 'CONTRACT' as WorkType,
  rateMin: '',
  rateMax: '',
  rateUnit: '' as RateUnit | '',
  location: '',
  remote: false,
  clientName: '',
  clientIndustry: '',
};

export default function TalentPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [filters, setFilters] = useState({ skillId: '', minLevel: '', availableWithinDays: '30', workType: '', city: '', remoteOk: true });
  const [results, setResults] = useState<{ total: number; candidates: TalentCard[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [req, setReq] = useState(EMPTY_REQUEST);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    api<Domain[]>('/taxonomy').then(setDomains).catch(() => undefined);
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError('');
    const q = new URLSearchParams();
    if (filters.skillId) q.set('skillId', filters.skillId);
    if (filters.minLevel) q.set('minLevel', filters.minLevel);
    if (filters.availableWithinDays) q.set('availableWithinDays', filters.availableWithinDays);
    if (filters.workType) q.set('workType', filters.workType);
    if (filters.city.trim()) {
      q.set('city', filters.city.trim());
      q.set('remoteOk', String(filters.remoteOk));
    }
    q.set('limit', '30');
    try {
      setResults(await api<{ total: number; candidates: TalentCard[] }>(`/staffing/candidates?${q.toString()}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function sendRequest(c: TalentCard) {
    setSending(true);
    setSendError('');
    const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
    try {
      const r = await api<{ id: string; status: RequestStatus }>('/staffing/requests', {
        method: 'POST',
        body: JSON.stringify({
          candidateId: c.candidateId,
          roleTitle: req.roleTitle,
          summary: req.summary,
          workType: req.workType,
          rateMinInr: num(req.rateMin),
          rateMaxInr: num(req.rateMax),
          rateUnit: req.rateUnit || undefined,
          location: req.location || undefined,
          remote: req.remote,
          clientName: req.clientName || undefined,
          clientIndustry: req.clientIndustry || undefined,
        }),
      });
      setResults((res) =>
        res
          ? { ...res, candidates: res.candidates.map((x) => (x.candidateId === c.candidateId ? { ...x, lastRequest: { id: r.id, status: 'PENDING' } } : x)) }
          : res,
      );
      setOpenFor(null);
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function openRequest(c: TalentCard) {
    // Keep the last role's details — staffing companies usually check several people for the same role.
    setReq((r) => ({ ...r, workType: c.workTypes.includes(r.workType) ? r.workType : c.workTypes[0] ?? r.workType }));
    setSendError('');
    setOpenFor(c.candidateId);
  }

  return (
    <main className="container-wide">
      <h1>Find talent</h1>
      <p>
        Candidates who&apos;ve opted in to staffing companies and confirmed their availability in the last 30 days. Names and
        contact details are shared once a candidate accepts your request — see{' '}
        <Link href="/employer/requests">Availability requests</Link>.
      </p>

      <form className="card staffing-filters" onSubmit={search}>
        <div className="field">
          <label htmlFor="f-skill">Verified skill</label>
          <select id="f-skill" value={filters.skillId} onChange={(e) => setFilters({ ...filters, skillId: e.target.value })}>
            <option value="">Any skill</option>
            {domains.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-level">Minimum level</label>
          <select id="f-level" value={filters.minLevel} onChange={(e) => setFilters({ ...filters, minLevel: e.target.value })}>
            <option value="">Any level</option>
            {['L1', 'L2', 'L3', 'L4'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-avail">Can start within</label>
          <select id="f-avail" value={filters.availableWithinDays} onChange={(e) => setFilters({ ...filters, availableWithinDays: e.target.value })}>
            <option value="">Any time</option>
            <option value="0">Immediately</option>
            <option value="15">15 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-work">Type of work</label>
          <select id="f-work" value={filters.workType} onChange={(e) => setFilters({ ...filters, workType: e.target.value })}>
            <option value="">Any</option>
            {WORK_TYPES.map((w) => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-city">City</label>
          <input id="f-city" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} placeholder="e.g. Pune" />
          <label className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={filters.remoteOk} onChange={(e) => setFilters({ ...filters, remoteOk: e.target.checked })} />
            Include people open to remote
          </label>
        </div>
        <div className="field staffing-filters-go">
          <button type="submit" disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {results && (
        <p className="meta">
          {results.total} candidate{results.total === 1 ? '' : 's'} match
        </p>
      )}

      {results?.candidates.map((c) => {
        const rate = formatRate(c.expectedRateMinInr, c.expectedRateMaxInr, c.expectedRateUnit);
        const pending = c.lastRequest?.status === 'PENDING';
        return (
          <div key={c.candidateId} className="card staffing-talent">
            <div className="row" style={{ margin: 0, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <strong>
                {c.ref} · {c.roleTitle ? ROLE_TITLE_LABEL[c.roleTitle] ?? c.roleTitle : 'AI professional'}
              </strong>
              <span className="staffing-avail">{formatAvailability(c)}</span>
            </div>
            <div className="meta">
              {[
                c.yearsOfExp != null ? `${c.yearsOfExp} yrs experience` : null,
                c.aiYearsOfExp != null ? `${c.aiYearsOfExp} in AI` : null,
                c.location,
                c.openToRemote ? 'open to remote' : null,
                `confirmed ${daysAgo(c.availabilityConfirmedAt) ?? 0}d ago`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="staffing-facts">
              {c.workTypes.map((w) => <span key={w}>{WORK_TYPE_LABEL[w]}</span>)}
              {rate && <span>{rate}</span>}
            </div>
            <div className="staffing-skills">
              {c.verifiedSkills.map((s) => (
                <span key={s.skillId} className="ui-badge ui-badge-verified">{s.skillName} · {s.level}</span>
              ))}
            </div>

            {openFor === c.candidateId ? (
              <div className="staffing-request-form">
                <div className="field">
                  <label htmlFor="r-role">Role</label>
                  <input id="r-role" maxLength={120} value={req.roleTitle} onChange={(e) => setReq({ ...req, roleTitle: e.target.value })} placeholder="e.g. LLM Engineer (6-month contract)" />
                </div>
                <div className="field">
                  <label htmlFor="r-summary">What the role involves</label>
                  <textarea id="r-summary" rows={3} maxLength={1000} value={req.summary} onChange={(e) => setReq({ ...req, summary: e.target.value })} />
                </div>
                <div className="staffing-rate">
                  <select value={req.workType} onChange={(e) => setReq({ ...req, workType: e.target.value as WorkType })}>
                    {WORK_TYPES.map((w) => <option key={w} value={w}>{WORK_TYPE_LABEL[w]}</option>)}
                  </select>
                  <input type="number" min={0} placeholder="Rate min ₹" value={req.rateMin} onChange={(e) => setReq({ ...req, rateMin: e.target.value })} />
                  <input type="number" min={0} placeholder="Rate max ₹" value={req.rateMax} onChange={(e) => setReq({ ...req, rateMax: e.target.value })} />
                  <select value={req.rateUnit} onChange={(e) => setReq({ ...req, rateUnit: e.target.value as RateUnit })}>
                    <option value="">Per…</option>
                    {(Object.keys(RATE_UNIT_LABEL) as RateUnit[]).map((u) => <option key={u} value={u}>{RATE_UNIT_LABEL[u]}</option>)}
                  </select>
                </div>
                <div className="staffing-rate">
                  <input placeholder="Location (optional)" maxLength={120} value={req.location} onChange={(e) => setReq({ ...req, location: e.target.value })} />
                  <label className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={req.remote} onChange={(e) => setReq({ ...req, remote: e.target.checked })} />
                    Remote OK
                  </label>
                </div>
                <div className="staffing-rate">
                  <input placeholder="Client name (optional)" maxLength={120} value={req.clientName} onChange={(e) => setReq({ ...req, clientName: e.target.value })} />
                  <input placeholder="Client industry (optional)" maxLength={120} value={req.clientIndustry} onChange={(e) => setReq({ ...req, clientIndustry: e.target.value })} />
                </div>
                {sendError && <p className="error">{sendError}</p>}
                <div className="row" style={{ margin: 0 }}>
                  <button onClick={() => sendRequest(c)} disabled={sending || !req.roleTitle.trim() || !req.summary.trim()}>
                    {sending ? 'Sending…' : 'Send availability check'}
                  </button>
                  <button className="btn-secondary" onClick={() => setOpenFor(null)}>Cancel</button>
                </div>
                <p className="meta" style={{ margin: 0 }}>The candidate has 48 hours to reply.</p>
              </div>
            ) : (
              <div className="row" style={{ margin: '8px 0 0', justifyContent: 'space-between' }}>
                {c.lastRequest ? (
                  <span className="meta">Your last request: {REQUEST_STATUS_LABEL[c.lastRequest.status]}</span>
                ) : (
                  <span />
                )}
                <button onClick={() => openRequest(c)} disabled={pending}>
                  {pending ? 'Request open' : 'Check availability'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}
