'use client';

/**
 * Assessment catalog: one card per skill, one row per level (L1-L4), sourced
 * entirely from GET /assessments/catalog. All levels stay open — no
 * gating, no prerequisite on holding a lower level first. Earned state and
 * badge precedence (discussion > test for the same skill+level) are
 * resolved server-side (see BadgeResolverService) — this page only ever
 * renders what the API already decided, never re-derives precedence itself.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { isSafeReturnTo } from '@/lib/returnTo';
import { useRequireAuth } from '@/lib/useRequireAuth';

type SkillLevelName = 'L1' | 'L2' | 'L3' | 'L4';
type VerificationMethod = 'TEST' | 'DISCUSSION';

interface CatalogFormat {
  type: VerificationMethod;
  durationMins: number;
  assessmentId?: string;
  title?: string;
}
interface CatalogEarned {
  verifiedBy: VerificationMethod;
  verifyHash: string;
  issuedAt: string;
}
interface CatalogDiscussionState {
  sessionId: string;
  status: string;
  insufficientProbing: boolean;
  retakeAvailableAt: string | null;
}
interface CatalogLevel {
  level: SkillLevelName;
  formats: CatalogFormat[];
  earned: CatalogEarned | null;
  discussion: CatalogDiscussionState | null;
}
interface CatalogSkill {
  skillId: string;
  skillName: string;
  domainName: string;
  description: string | null;
  levels: CatalogLevel[];
}

/**
 * The discussion format's own action, independent of whatever the test
 * format's action is doing on the same row — no session yet gets a plain
 * Start (named with format+duration only when a test format is also present
 * on this level, i.e. there's an actual choice to name); an existing session
 * drives Resume/In review/retake-cooldown exactly like the pre-restructure
 * page did (see the retake-cooldown feature this reuses verbatim).
 */
function DiscussionAction({
  discussion,
  durationMins,
  namedChoice,
}: {
  discussion: CatalogDiscussionState | null;
  durationMins: number;
  namedChoice: boolean;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setStarting(true);
    setError('');
    try {
      const created = await api<{ session: { id: string } }>('/assessment-sessions', { method: 'POST' });
      router.push(`/assessments/discussion/session/${created.session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(false);
    }
  }

  if (!discussion) {
    return (
      <div>
        <button onClick={start} disabled={starting}>
          {starting ? 'Starting…' : namedChoice ? `Discussion · ${durationMins} min` : 'Start'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (discussion.status === 'IN_PROGRESS' || discussion.status === 'EXPIRED') {
    return (
      <Link href="/assessments/discussion/rag-systems-l2">
        <button>Resume your session</button>
      </Link>
    );
  }
  if (discussion.status === 'AWAITING_SCORING' || discussion.status === 'AWAITING_REVIEW') {
    return <span className="meta">In review</span>;
  }
  if (discussion.status === 'DISPUTED') {
    return <span className="meta">Available after your dispute is resolved</span>;
  }
  if (discussion.status === 'REJECTED') {
    const cooldownActive =
      !discussion.insufficientProbing &&
      !!discussion.retakeAvailableAt &&
      new Date(discussion.retakeAvailableAt).getTime() > Date.now();
    if (cooldownActive) {
      return <span className="meta">Retake available from {new Date(discussion.retakeAvailableAt!).toLocaleDateString()}</span>;
    }
    return (
      <div>
        <button onClick={start} disabled={starting}>
          {starting
            ? 'Starting…'
            : discussion.insufficientProbing
              ? "This session didn't give you a fair shot — retake now"
              : 'Retake assessment'}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  // ISSUED (or anything else terminal) — this level's `earned` should already
  // reflect DISCUSSION by the time this would render; nothing more to offer.
  return null;
}

function availabilityText(level: CatalogLevel): string {
  const test = level.formats.find((f) => f.type === 'TEST');
  const discussion = level.formats.find((f) => f.type === 'DISCUSSION');
  if (test && discussion) return `test, ${test.durationMins} min or discussion, ${discussion.durationMins} min`;
  if (discussion) return `discussion only, ${discussion.durationMins} min`;
  return `test only, ${test!.durationMins} min`;
}

function LevelRow({ level }: { level: CatalogLevel }) {
  const test = level.formats.find((f) => f.type === 'TEST');
  const discussionFormat = level.formats.find((f) => f.type === 'DISCUSSION');

  // Strongest evidence already held — terminal, no action at all.
  if (level.earned?.verifiedBy === 'DISCUSSION') {
    return (
      <div className="assessment-row">
        <div className="assessment-info">
          <strong>Level {level.level}</strong>
          <div className="meta assessment-earned">✓ Earned · verified by discussion</div>
        </div>
      </div>
    );
  }

  // Earned by test — terminal unless a discussion format exists, in which
  // case offer the upgrade path (still cooldown/dispute-aware via
  // DiscussionAction, since starting it is subject to the same rules
  // whether or not this level is already held by a weaker format).
  if (level.earned?.verifiedBy === 'TEST') {
    return (
      <div className="assessment-row">
        <div className="assessment-info">
          <strong>Level {level.level}</strong>
          <div className="meta assessment-earned">✓ Earned · verified by test</div>
          {discussionFormat && (
            <div className="meta" style={{ marginTop: 4 }}>
              Prove this by discussion for stronger evidence — a reviewer sees how you reason, not just your score.
            </div>
          )}
        </div>
        {discussionFormat && (
          <div className="assessment-actions">
            <DiscussionAction discussion={level.discussion} durationMins={discussionFormat.durationMins} namedChoice={true} />
          </div>
        )}
      </div>
    );
  }

  // Not earned at all — every available format stays open, independently.
  return (
    <div className="assessment-row">
      <div className="assessment-info">
        <strong>Level {level.level}</strong>
        <div className="meta">Not earned · {availabilityText(level)}</div>
      </div>
      <div className="assessment-actions">
        {test && (
          <Link href={`/assessments/${test.assessmentId}`}>
            <button>{discussionFormat ? `Test · ${test.durationMins} min` : 'Start'}</button>
          </Link>
        )}
        {discussionFormat && (
          <DiscussionAction discussion={level.discussion} durationMins={discussionFormat.durationMins} namedChoice={!!test} />
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: CatalogSkill }) {
  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ marginBottom: 10 }}>
        <span className="eyebrow">{skill.domainName}</span>
        <div style={{ marginTop: 4 }}>
          <strong style={{ fontSize: '1.05rem' }}>{skill.skillName}</strong>
          {skill.description && <div className="meta">{skill.description}</div>}
        </div>
      </div>
      {skill.levels.map((level) => (
        <LevelRow key={level.level} level={level} />
      ))}
    </div>
  );
}

function AssessmentsPageInner() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  const ready = useRequireAuth();
  const [skills, setSkills] = useState<CatalogSkill[]>([]);
  const [error, setError] = useState('');
  // Light, non-blocking nudge only — an empty profile never blocks taking
  // an assessment, it's just surfaced as a tip below.
  const [profileEmpty, setProfileEmpty] = useState(false);

  const load = useCallback(() => {
    api<CatalogSkill[]>('/assessments/catalog')
      .then(setSkills)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    api<{ completeness: number }>('/profiles/me')
      .then((p) => setProfileEmpty(p.completeness === 0))
      .catch(() => undefined);
  }, [ready, load]);

  if (!ready) return null;

  return (
    <>
      <CandidateNav />
      <main>
        <h1>Assessments</h1>
        <p>Pass an assessment to earn a verified skill badge.</p>
        {error && <p className="error">{error}</p>}
        {skills.length === 0 && !error && (
          <p>
            No assessments are available just yet — check back soon. In the
            meantime, you can{' '}
            <Link href="/profile">add a verified credential</Link> on your
            profile to start applying.
          </p>
        )}
        {profileEmpty && skills.length > 0 && (
          <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
            Tip: completing your profile helps employers find you once you&apos;ve earned a badge —{' '}
            <Link href="/profile">complete your profile →</Link>
          </p>
        )}
        {isSafeReturnTo(returnTo) && skills.length > 0 && (
          <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
            Pass an assessment to earn a verified badge, then{' '}
            <Link href={returnTo}>return to the job you were applying to →</Link>
          </p>
        )}

        {skills.map((skill) => (
          <SkillCard key={skill.skillId} skill={skill} />
        ))}
      </main>
    </>
  );
}

export default function AssessmentsPage() {
  return (
    <Suspense fallback={<main><p>Loading…</p></main>}>
      <AssessmentsPageInner />
    </Suspense>
  );
}
