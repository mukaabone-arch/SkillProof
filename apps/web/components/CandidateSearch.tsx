'use client';

/** Employer candidate search: filter by taxonomy skill + min level + verified-only, browse results. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { employerApi } from '@/lib/api';
import ShortlistButton from './ShortlistButton';

const { api } = employerApi;

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
  verifiedBy: 'TEST' | 'DISCUSSION';
  verifyHash: string;
}

/** Display/filter only — mirrors the API's CandidateRoleTitle enum. Never fed into match scoring. */
type CandidateRoleTitle =
  | 'AI_ENGINEER'
  | 'ML_ENGINEER'
  | 'PROMPT_ENGINEER'
  | 'DATA_SCIENTIST'
  | 'MLOPS_ENGINEER'
  | 'NLP_ENGINEER'
  | 'COMPUTER_VISION_ENGINEER'
  | 'RESEARCH_ENGINEER'
  | 'DATA_ENGINEER'
  | 'AI_PRODUCT_MANAGER'
  | 'OTHER';

const ROLE_TITLE_LABELS: Record<CandidateRoleTitle, string> = {
  AI_ENGINEER: 'AI Engineer',
  ML_ENGINEER: 'ML Engineer',
  PROMPT_ENGINEER: 'Prompt Engineer',
  DATA_SCIENTIST: 'Data Scientist',
  MLOPS_ENGINEER: 'MLOps Engineer',
  NLP_ENGINEER: 'NLP Engineer',
  COMPUTER_VISION_ENGINEER: 'Computer Vision Engineer',
  RESEARCH_ENGINEER: 'Research Engineer',
  DATA_ENGINEER: 'Data Engineer',
  AI_PRODUCT_MANAGER: 'AI Product Manager',
  OTHER: 'Other',
};

const ROLE_TITLE_OPTIONS = Object.keys(ROLE_TITLE_LABELS) as CandidateRoleTitle[];

interface CandidateResult {
  profileId: string;
  fullName: string | null;
  headline: string | null;
  roleTitle: CandidateRoleTitle | null;
  roleTitleOther: string | null;
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

/** Only the fields needed to build the "already shortlisted" lookup — see ShortlistScreen for the full shape. */
interface ShortlistEntrySummary {
  id: string;
  candidateId: string;
  job: { id: string; title: string } | null;
}

const LEVELS = ['L1', 'L2', 'L3', 'L4'];

export default function CandidateSearch() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [skillId, setSkillId] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [verifiedOnly, setVerifiedOnly] = useState(true);

  const [results, setResults] = useState<CandidateResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // candidateId -> shortlist entry id, general (no job) entries only — search
  // results aren't tied to any one job, so "Shortlist" here always adds a
  // jobId-less entry (see ShortlistButton's onClick with no jobId passed).
  const [shortlistMap, setShortlistMap] = useState<Record<string, string>>({});

  useEffect(() => {
    api<Domain[]>('/taxonomy').then(setDomains).catch(() => undefined);
    api<ShortlistEntrySummary[]>('/shortlist')
      .then((entries) => {
        const map: Record<string, string> = {};
        entries.filter((e) => e.job === null).forEach((e) => { map[e.candidateId] = e.id; });
        setShortlistMap(map);
      })
      .catch(() => undefined);
  }, []);

  async function search() {
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (skillId) params.set('skillId', skillId);
      if (minLevel) params.set('minLevel', minLevel);
      if (roleTitle) params.set('roleTitle', roleTitle);
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

        <div className="field">
          <label htmlFor="roleTitle">Role</label>
          <select id="roleTitle" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)}>
            <option value="">Any role</option>
            {ROLE_TITLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{ROLE_TITLE_LABELS[r]}</option>
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
          <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
            <strong>{c.fullName || 'Candidate'}</strong>
            <ShortlistButton
              candidateId={c.profileId}
              entryId={shortlistMap[c.profileId] ?? null}
              onAdded={(entryId) => setShortlistMap((prev) => ({ ...prev, [c.profileId]: entryId }))}
              onRemoved={() => setShortlistMap((prev) => {
                const next = { ...prev };
                delete next[c.profileId];
                return next;
              })}
              onError={setError}
            />
          </div>
          {c.roleTitle && (
            <div className="meta">
              {c.roleTitle === 'OTHER' ? c.roleTitleOther || 'Other' : ROLE_TITLE_LABELS[c.roleTitle]}
            </div>
          )}
          {c.headline && <div className="meta">{c.headline}</div>}
          <div className="meta">
            {c.location || 'Location not set'}
            {c.yearsOfExp !== null && ` · ${c.yearsOfExp} yrs experience`}
          </div>
          {c.verifiedSkills.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', margin: 0, marginTop: 4 }}>
              {c.verifiedSkills.map((s) => (
                <Link key={s.skillId} href={`/badges/${s.verifyHash}`}>
                  <button title={s.verifiedBy === 'DISCUSSION' ? 'Verified by discussion' : 'Verified by test'}>
                    {s.skillName} ({s.level}) {s.verifiedBy === 'DISCUSSION' ? '💬' : ''}
                  </button>
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
