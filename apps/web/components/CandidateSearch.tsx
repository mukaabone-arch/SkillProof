'use client';

/** Employer candidate search: filter by taxonomy skill + min level + verified-only, browse results. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Skill {
  id: string;
  name: string;
}

interface Domain {
  id: string;
  name: string;
  skills: Skill[];
}

interface VerifiedSkill {
  skillId: string;
  skillName: string;
  level: string;
  verifyHash: string;
}

interface CandidateResult {
  profileId: string;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  verifiedSkills: VerifiedSkill[];
}

interface SearchResponse {
  total: number;
  limit: number;
  offset: number;
  candidates: CandidateResult[];
}

const LEVELS = ['L1', 'L2', 'L3', 'L4'];

export default function CandidateSearch() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [skillId, setSkillId] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(true);

  const [results, setResults] = useState<CandidateResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Domain[]>('/taxonomy').then(setDomains).catch(() => undefined);
  }, []);

  async function search() {
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (skillId) params.set('skillId', skillId);
      if (minLevel) params.set('minLevel', minLevel);
      params.set('verifiedOnly', String(verifiedOnly));

      const res = await api<SearchResponse>(`/candidates/search?${params.toString()}`);
      setResults(res.candidates);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <h2 style={{ marginTop: 32, marginBottom: 16 }}>Find candidates</h2>

      <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div className="field">
          <label htmlFor="searchSkill">Skill</label>
          <select id="searchSkill" value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">Any skill</option>
            {domains.map((d) => (
              <optgroup key={d.id} label={d.name}>
                {d.skills.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="minLevel">Minimum level</label>
          <select id="minLevel" value={minLevel} onChange={(e) => setMinLevel(e.target.value)}>
            <option value="">Any level</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>

        <label className="row" style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={verifiedOnly}
            onChange={(e) => setVerifiedOnly(e.target.checked)}
          />
          Verified matches only
        </label>

        <button onClick={search} disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {total !== null && (
        <p className="meta" style={{ marginTop: 12 }}>
          {total} candidate{total === 1 ? '' : 's'} found
        </p>
      )}

      {results.map((c) => (
        <div
          key={c.profileId}
          className="card"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
        >
          <strong>{c.fullName || 'Candidate'}</strong>
          {c.headline && <div className="meta">{c.headline}</div>}
          <div className="meta">
            {c.location || 'Location not set'}
            {c.yearsOfExp !== null && ` · ${c.yearsOfExp} yrs experience`}
          </div>
          {c.verifiedSkills.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', margin: 0, marginTop: 4 }}>
              {c.verifiedSkills.map((s) => (
                <Link key={s.skillId} href={`/badges/${s.verifyHash}`}>
                  <button>{s.skillName} ({s.level})</button>
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
