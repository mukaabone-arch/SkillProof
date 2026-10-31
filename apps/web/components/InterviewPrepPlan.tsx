'use client';

/**
 * The per-interview prep plan opened from a card in CandidateInterviews —
 * GET /interviews/:id/prep. Built from this job's skills against the
 * candidate's own live badges: what they've proven (with their own
 * skill-check coaching notes where the discussion format left some), what
 * the employer will probe, the role at a glance, a few curated behavioral
 * questions from the admin question bank, and a checklist they tick off.
 *
 * Nothing here is AI-generated at view time. The behavioral questions sit
 * behind the same interviewPrep entitlement as InterviewPrepPanel's guides
 * (Free sees the count, Premium sees the questions); everything else is the
 * candidate's own data and is shown on every plan.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { ErrorState, LoadingState } from '@/components/ui';
import { LockedPreview } from './LockedPreview';
import AiConsentNotice, { isAiConsentRequired } from './AiConsentNotice';

type Level = 'L1' | 'L2' | 'L3' | 'L4';

interface Prep {
  id: string;
  orgName: string;
  jobTitle: string | null;
  job: {
    location: string | null;
    remote: boolean;
    experienceMin: number | null;
    experienceMax: number | null;
    descriptionExcerpt: string | null;
  } | null;
  candidate: { yearsOfExp: number | null; location: string | null };
  proven: { skillId: string; skillName: string; requiredLevel: Level; level: Level; isRequired: boolean; strengths: string[]; gaps: string[] }[];
  toProbe: { skillId: string; skillName: string; requiredLevel: Level; isRequired: boolean; candidateLevel: Level | null; hasSkillCheck: boolean }[];
  questions: { id: string; text: string; whatToLookFor: string; followUp: string | null }[];
  checklist: string[];
  applicationId: string | null;
}

const CHECKLIST: { key: string; label: string }[] = [
  { key: 'reread-job', label: 'Re-read the job post' },
  { key: 'review-results', label: 'Review your skill-check results' },
  { key: 'stories', label: 'Prepare 2 stories with numbers in them' },
  { key: 'questions', label: 'Pick 3 questions to ask them' },
  { key: 'tech-check', label: 'Test camera, mic and the meeting link' },
];

function experienceLine(job: NonNullable<Prep['job']>, yours: number | null): string | null {
  const { experienceMin: min, experienceMax: max } = job;
  if (min === null && max === null) return null;
  const asked = min !== null && max !== null ? `${min}–${max} years` : min !== null ? `${min}+ years` : `up to ${max} years`;
  return yours !== null ? `${asked} · you have ${yours}` : asked;
}

export default function InterviewPrepPlan({ interviewId }: { interviewId: string }) {
  const { limits } = useEntitlements();
  const [prep, setPrep] = useState<Prep | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string[]>([]);
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [practiceError, setPracticeError] = useState('');

  async function startPractice(applicationId: string | null) {
    setStarting(true);
    setPracticeError('');
    try {
      const r = await api<{ session: { id: string } }>('/interview-sessions', {
        method: 'POST',
        body: JSON.stringify(applicationId ? { applicationId } : {}),
      });
      router.push(`/interviews/practice/${r.session.id}`);
    } catch (e) {
      if (isAiConsentRequired(e)) setNeedsConsent(true);
      else setPracticeError((e as Error).message);
      setStarting(false);
    }
  }

  useEffect(() => {
    api<Prep>(`/interviews/${interviewId}/prep`)
      .then((p) => {
        setPrep(p);
        setDone(p.checklist);
      })
      .catch((e) => setError((e as Error).message));
  }, [interviewId]);

  async function toggle(key: string) {
    const next = done.includes(key) ? done.filter((k) => k !== key) : [...done, key];
    const previous = done;
    setDone(next);
    try {
      await api(`/interviews/${interviewId}/prep/checklist`, { method: 'PUT', body: JSON.stringify({ done: next }) });
    } catch (e) {
      setDone(previous);
      setError((e as Error).message);
    }
  }

  if (!prep) return error ? <ErrorState message={error} /> : <LoadingState />;

  const required = [...prep.proven, ...prep.toProbe].filter((s) => s.isRequired);
  const provenRequired = prep.proven.filter((s) => s.isRequired).length;
  const steps = required.length + CHECKLIST.length;
  const stepsDone = provenRequired + done.length;
  const pct = steps === 0 ? 0 : Math.round((stepsDone / steps) * 100);
  const exp = prep.job ? experienceLine(prep.job, prep.candidate.yearsOfExp) : null;

  return (
    <div className="prep-plan">
      {error && <ErrorState message={error} />}
      <div className="prep-plan-head">
        <div className="prep-ring" style={{ ['--pct' as string]: `${pct}%` }} aria-hidden="true">
          <span>{pct}%</span>
        </div>
        <div>
          <strong>Your prep plan for this role</strong>
          <div className="meta">
            {required.length > 0
              ? `Built from this job's ${required.length} required skill${required.length === 1 ? '' : 's'} and your verified badges · `
              : ''}
            {stepsDone} of {steps} steps done
          </div>
        </div>
      </div>

      {prep.proven.length > 0 && (
        <section className="prep-sec">
          <h3><span className="prep-dot prep-dot-ok" />You&apos;ve proven these<span className="meta">{provenRequired} of {required.length} required</span></h3>
          {prep.proven.map((s) => (
            <div key={s.skillId} className="prep-row">
              <div className="prep-skill">
                {s.skillName} <span className="ui-badge ui-badge-verified">Verified · {s.level}</span>
                {!s.isRequired && <span className="meta">nice to have</span>}
              </div>
              {s.strengths.length > 0 && (
                <p className="meta">Your skill check showed strength in: {s.strengths.join('; ')}.</p>
              )}
              {s.gaps.length > 0 && <p className="meta">Worth tightening before the interview: {s.gaps[0]}.</p>}
              <p className="meta">
                Expect a question that asks you to justify a trade-off in {s.skillName}, not just define it — have one real
                example ready.
              </p>
            </div>
          ))}
        </section>
      )}

      {prep.toProbe.length > 0 && (
        <section className="prep-sec">
          <h3><span className="prep-dot prep-dot-warn" />They&apos;ll probe these<span className="meta">{prep.toProbe.length} not yet verified</span></h3>
          <p className="meta prep-probe-tip">
            Expect questions on each of these. Have a real example ready; if you haven&apos;t used one in production, say so
            plainly and explain how you&apos;d approach it. Verifying one before the interview is the strongest answer.
          </p>
          {prep.toProbe.map((s) => (
            <div key={s.skillId} className="prep-row prep-row-compact">
              <div className="prep-skill">
                {s.skillName}{' '}
                <span className="ui-badge ui-badge-warning">
                  {s.isRequired ? 'Required' : 'Nice to have'}
                  {s.candidateLevel ? ` · you have ${s.candidateLevel}, needs ${s.requiredLevel}` : ''}
                </span>
              </div>
              {s.hasSkillCheck && (
                <Link href="/assessments" className="prep-link">
                  Skill check →
                </Link>
              )}
            </div>
          ))}
        </section>
      )}

      {prep.job && (
        <section className="prep-sec">
          <h3><span className="prep-dot prep-dot-brand" />Know the company &amp; role</h3>
          <div className="prep-row prep-kv">
            <span>Role</span><b>{prep.jobTitle ?? '—'} at {prep.orgName}</b>
            {exp && (<><span>Experience asked</span><b>{exp}</b></>)}
            {(prep.job.location || prep.job.remote) && (
              <>
                <span>Location</span>
                <b>
                  {[prep.job.location, prep.job.remote ? 'remote OK' : null].filter(Boolean).join(' · ')}
                  {prep.candidate.location ? ` · you're in ${prep.candidate.location}` : ''}
                </b>
              </>
            )}
            {prep.job.descriptionExcerpt && (<><span>From the job post</span><b>&ldquo;{prep.job.descriptionExcerpt}&rdquo;</b></>)}
          </div>
        </section>
      )}

      {prep.questions.length > 0 && limits && (
        <section className="prep-sec">
          <h3><span className="prep-dot prep-dot-brand" />Behavioral questions to rehearse</h3>
          {limits.interviewPrep ? (
            prep.questions.map((q) => (
              <div key={q.id} className="prep-row">
                <div className="prep-skill">{q.text}</div>
                <p className="meta">What they&apos;re looking for: {q.whatToLookFor}</p>
                {q.followUp && <p className="meta">Likely follow-up: {q.followUp}</p>}
              </div>
            ))
          ) : (
            <div className="prep-row">
              <LockedPreview teaser={`${prep.questions.length} questions picked for this interview, with what interviewers look for.`} ctaLabel="Upgrade to read">
                <div>{prep.questions.map((q) => <p key={q.id}>{q.text}</p>)}</div>
              </LockedPreview>
            </div>
          )}
        </section>
      )}

      {limits && (
        <section className="prep-sec prep-practice">
          <div className="prep-row">
            <div className="prep-skill">Practice this interview</div>
            <p className="meta">
              A 15–20 minute mock interview with questions like the ones above, then written feedback on each answer.
              Practice only — never shown to employers.
            </p>
            {practiceError && <ErrorState message={practiceError} />}
            {needsConsent && (
              <AiConsentNotice
                onAgreed={() => {
                  setNeedsConsent(false);
                  startPractice(prep.applicationId);
                }}
              />
            )}
            {limits.interviewPrep && !needsConsent ? (
              <button className="prep-cta" onClick={() => startPractice(prep.applicationId)} disabled={starting}>
                {starting ? 'Starting…' : 'Start practice interview'}
              </button>
            ) : !limits.interviewPrep ? (
              <Link href="/upgrade" className="btn btn-primary prep-cta">Upgrade to practice</Link>
            ) : null}
          </div>
        </section>
      )}

      <section className="prep-sec">
        <h3><span className="prep-dot" />Before the interview<span className="meta">{done.length} of {CHECKLIST.length} done</span></h3>
        <div className="prep-row">
          {CHECKLIST.map((c) => (
            <label key={c.key} className="prep-check">
              <input type="checkbox" checked={done.includes(c.key)} onChange={() => toggle(c.key)} />
              {c.label}
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
