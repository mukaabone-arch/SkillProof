'use client';

/**
 * Assessment catalog: one card per skill, one row per level (L1-L4), sourced
 * entirely from GET /assessments/catalog. Strict sequential leveling: a
 * candidate may only attempt the level immediately after their highest
 * earned level in a skill — level.state (EARNED/SUBSUMED/AVAILABLE/LOCKED)
 * says which, already fully resolved server-side (see
 * BadgeResolverService.deriveLevelStates). This page only ever renders
 * what the API already decided — hiding the Start button here is a UX
 * courtesy, not the enforcement; the server rejects a locked attempt too
 * (see BadgeResolverService.assertLevelAvailable).
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type ApiError } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { isSafeReturnTo } from '@/lib/returnTo';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { isProfileReadyForAssessment, missingReadinessFields, readinessGateMessage } from '@/lib/profileReadiness';
import { useEntitlements } from '@/lib/entitlements';
import { UsageMeter } from '@/components/UsageMeter';

type SkillLevelName = 'L1' | 'L2' | 'L3' | 'L4';
type VerificationMethod = 'TEST' | 'DISCUSSION';
type LevelState = 'EARNED' | 'SUBSUMED' | 'AVAILABLE' | 'LOCKED';

/**
 * Human names for the level codes — first-time candidates have no reason to
 * know what "L2" means. The code stays visible as a secondary label (existing
 * users' mental model of "L1/L2/L3" isn't erased, just explained), and each
 * description makes the ascending rigor legible without a separate legend.
 */
const LEVEL_INFO: Record<SkillLevelName, { name: string; description: string }> = {
  L1: { name: 'Foundational', description: 'Understands the core concepts and can apply them with guidance.' },
  L2: { name: 'Practitioner', description: 'Applies the skill independently on real work.' },
  L3: { name: 'Advanced', description: 'Handles complex, ambiguous problems with this skill.' },
  L4: { name: 'Expert', description: "Deep mastery — can review others' work and set technical direction." },
};

function LevelHeading({ level }: { level: SkillLevelName }) {
  return (
    <strong>
      {LEVEL_INFO[level].name} <span className="meta" style={{ marginTop: 0 }}>· Level {level}</span>
    </strong>
  );
}

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
  state: LevelState;
  unlocksAfterLevel: SkillLevelName | null;
  coveredByLevel: SkillLevelName | null;
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
  profileReady,
}: {
  discussion: CatalogDiscussionState | null;
  durationMins: number;
  namedChoice: boolean;
  profileReady: boolean;
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
      // Disabling the button below is the UX courtesy; this catch is the
      // defense-in-depth path for a stale page or a race with a profile edit
      // in another tab — the server's PROFILE_INCOMPLETE_FOR_ASSESSMENT
      // message is already candidate-friendly, so surface it as-is.
      const body = (e as ApiError).body as { code?: string; message?: string } | undefined;
      setError(body?.code === 'PROFILE_INCOMPLETE_FOR_ASSESSMENT' && body.message ? body.message : (e as Error).message);
      setStarting(false);
    }
  }

  if (!discussion) {
    return (
      <div>
        <button onClick={start} disabled={starting || !profileReady} title={profileReady ? undefined : 'Complete your profile to unlock'}>
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
      return (
        <span className="meta">
          Retakes are limited so badges stay credible to employers — you can try again from{' '}
          {new Date(discussion.retakeAvailableAt!).toLocaleDateString()}.
        </span>
      );
    }
    return (
      <div>
        <button onClick={start} disabled={starting || !profileReady} title={profileReady ? undefined : 'Complete your profile to unlock'}>
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

/**
 * The not-yet-earned level's own explanation of its format(s) — when both a
 * test and a discussion are offered, says plainly that either earns the same
 * badge and why a candidate might pick one over the other, rather than
 * leaving "test or discussion" as an unexplained choice.
 */
function AvailabilityMeta({ level }: { level: CatalogLevel }) {
  const test = level.formats.find((f) => f.type === 'TEST');
  const discussion = level.formats.find((f) => f.type === 'DISCUSSION');
  if (test && discussion) {
    return (
      <div className="meta">
        Not earned yet. Choose a timed test ({test.durationMins} min) or a live discussion (
        {discussion.durationMins} min) — either earns the same badge; the discussion option also lets a reviewer
        see your reasoning, not just your answers.
      </div>
    );
  }
  if (discussion) return <div className="meta">Not earned yet · discussion only, {discussion.durationMins} min</div>;
  return <div className="meta">Not earned yet · test only, {test!.durationMins} min</div>;
}

function LevelRow({ level, profileReady }: { level: CatalogLevel; profileReady: boolean }) {
  const test = level.formats.find((f) => f.type === 'TEST');
  const discussionFormat = level.formats.find((f) => f.type === 'DISCUSSION');

  // Above the level immediately after highest earned — not attemptable yet.
  // No button at all: hiding it is a UX courtesy, the server rejects the
  // attempt too (see BadgeResolverService.assertLevelAvailable).
  if (level.state === 'LOCKED') {
    return (
      <div className="assessment-row assessment-row-locked">
        <div className="assessment-info">
          <LevelHeading level={level.level} />
          <div className="meta">{LEVEL_INFO[level.level].description}</div>
          <div className="meta">
            🔒 Unlocks after you earn {LEVEL_INFO[level.unlocksAfterLevel!].name} (Level {level.unlocksAfterLevel})
          </div>
        </div>
      </div>
    );
  }

  // Below the highest earned level, with no badge of its own — a gap left
  // by an out-of-order (grandfathered) badge. Covered by the higher badge,
  // never re-required.
  if (level.state === 'SUBSUMED') {
    return (
      <div className="assessment-row">
        <div className="assessment-info">
          <LevelHeading level={level.level} />
          <div className="meta">{LEVEL_INFO[level.level].description}</div>
          <div className="meta">
            Covered by your {LEVEL_INFO[level.coveredByLevel!].name} badge (Level {level.coveredByLevel}) ✓
          </div>
        </div>
      </div>
    );
  }

  // Strongest evidence already held — terminal, no action at all.
  if (level.earned?.verifiedBy === 'DISCUSSION') {
    return (
      <div className="assessment-row">
        <div className="assessment-info">
          <LevelHeading level={level.level} />
          <div className="meta">{LEVEL_INFO[level.level].description}</div>
          <div className="meta assessment-earned">
            ✓ Badge earned — verified by a live discussion review employers can independently confirm.
          </div>
        </div>
      </div>
    );
  }

  // Earned by test — terminal unless a discussion format exists, in which
  // case offer the upgrade path (still cooldown/dispute-aware via
  // DiscussionAction, since starting it is subject to the same rules
  // whether or not this level is already held by a weaker format). The
  // upgrade action sits on the same header line as the level name, not
  // centered against the whole (now multi-line) info block below it, so
  // it's unambiguous which level it belongs to.
  if (level.earned?.verifiedBy === 'TEST') {
    return (
      <div className="assessment-row">
        <div className="assessment-info">
          <div className="assessment-row-header">
            <LevelHeading level={level.level} />
            {discussionFormat && (
              <div className="assessment-actions">
                <DiscussionAction
                  discussion={level.discussion}
                  durationMins={discussionFormat.durationMins}
                  namedChoice={true}
                  profileReady={profileReady}
                />
              </div>
            )}
          </div>
          <div className="meta">{LEVEL_INFO[level.level].description}</div>
          <div className="meta assessment-earned">
            ✓ Badge earned — verified by an automated test employers can independently confirm.
          </div>
          {discussionFormat && (
            <div className="meta" style={{ marginTop: 4 }}>
              Optional: retake this level via a live discussion for stronger evidence — a reviewer sees your
              reasoning, not just your score. Your test-verified badge stays valid either way.
            </div>
          )}
        </div>
      </div>
    );
  }

  // The one AVAILABLE level (LOCKED/SUBSUMED/EARNED are all handled above)
  // — every offered format stays open, independently. Actions sit next to
  // the level name itself (same header line), not vertically centered
  // against the info block below, so it's clear which level each button starts.
  return (
    <div className="assessment-row">
      <div className="assessment-info">
        <div className="assessment-row-header">
          <LevelHeading level={level.level} />
          <div className="assessment-actions">
            {test && (
              profileReady ? (
                <Link href={`/assessments/${test.assessmentId}`}>
                  <button>{discussionFormat ? `Test · ${test.durationMins} min` : 'Start'}</button>
                </Link>
              ) : (
                <button disabled title="Complete your profile to unlock">
                  {discussionFormat ? `Test · ${test.durationMins} min` : 'Start'}
                </button>
              )
            )}
            {discussionFormat && (
              <DiscussionAction
                discussion={level.discussion}
                durationMins={discussionFormat.durationMins}
                namedChoice={!!test}
                profileReady={profileReady}
              />
            )}
          </div>
        </div>
        <div className="meta">{LEVEL_INFO[level.level].description}</div>
        <AvailabilityMeta level={level} />
      </div>
    </div>
  );
}

function SkillCard({ skill, profileReady }: { skill: CatalogSkill; profileReady: boolean }) {
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
        <LevelRow key={level.level} level={level} profileReady={profileReady} />
      ))}
    </div>
  );
}

function AssessmentsPageInner() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  const ready = useRequireAuth();
  const { usage } = useEntitlements();
  const [skills, setSkills] = useState<CatalogSkill[]>([]);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<{
    completeness: number;
    fullName: string | null;
    headline: string | null;
    yearsOfExp: number | null;
  } | null>(null);

  const load = useCallback(() => {
    api<CatalogSkill[]>('/assessments/catalog')
      .then(setSkills)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    api<{ completeness: number; fullName: string | null; headline: string | null; yearsOfExp: number | null }>('/profiles/me')
      .then(setProfile)
      .catch(() => undefined);
  }, [ready, load]);

  if (!ready) return null;

  // Light, non-blocking nudge only — an empty profile never blocks taking an
  // assessment by itself, it's just surfaced as a tip below.
  const profileEmpty = profile ? profile.completeness === 0 : false;
  // Real gate: assumed ready until the profile actually loads and says
  // otherwise, so a ready candidate never sees a flash of disabled buttons —
  // the server enforces the real rule regardless (PROFILE_INCOMPLETE_FOR_ASSESSMENT).
  const profileReady = profile ? isProfileReadyForAssessment(profile) : true;
  const missing = profile ? missingReadinessFields(profile) : [];
  const gateMessage = readinessGateMessage(missing);

  return (
    <>
      <CandidateNav />
      <main>
        <h1>Assessments</h1>
        <p>
          Pass an assessment to earn a verified skill badge for your profile. Employers can see every badge
          you&apos;ve earned — and it&apos;s verified badges, not self-reported skills, that drive your job matches.
        </p>
        <p>
          Each skill has up to four levels — Foundational, Practitioner, Advanced, and Expert — each one more
          rigorous than the last. Employers see exactly which level you&apos;ve reached for every skill.
        </p>
        {usage && (
          <UsageMeter
            label="assessment starts"
            used={usage.assessments.used}
            limit={usage.assessments.limit}
            resetsAt={usage.assessments.resetsAt}
          />
        )}
        {error && <p className="error">{error}</p>}
        {skills.length === 0 && !error && (
          <p>
            No assessments are available just yet — check back soon. In the
            meantime, you can{' '}
            <Link href="/profile">add a verified credential</Link> on your
            profile to start applying.
          </p>
        )}
        {!profileReady && skills.length > 0 && (
          <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
            {gateMessage} <Link href="/profile?returnTo=/assessments">Complete your profile →</Link>
          </p>
        )}
        {profileReady && profileEmpty && skills.length > 0 && (
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
        {skills.length > 0 && (
          // The catalog endpoint always returns the complete set (no
          // pagination) — whatever renders below is genuinely everything
          // available, so say so explicitly rather than leaving a candidate
          // to wonder whether a short list means the page is broken.
          <p className="meta" style={{ marginTop: -8, marginBottom: 20 }}>
            Showing the full assessment catalog — {skills.length} skill{skills.length === 1 ? '' : 's'} available
            right now.
          </p>
        )}

        {skills.map((skill) => (
          <SkillCard key={skill.skillId} skill={skill} profileReady={profileReady} />
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
