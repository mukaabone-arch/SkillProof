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
import { ReactNode, Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type ApiError } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { isSafeReturnTo } from '@/lib/returnTo';
import { useRequireAuth } from '@/lib/useRequireAuth';
import { isProfileReadyForAssessment, missingReadinessFields, readinessGateMessage } from '@/lib/profileReadiness';
import { useEntitlements } from '@/lib/entitlements';
import { UsageMeter } from '@/components/UsageMeter';
import EmployerInvitations from '@/components/EmployerInvitations';

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
  expiresAt: string;
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
  /**
   * Set only when `earned` is null but a badge that once counted here has
   * since expired — the server never lets an expired badge appear as
   * `earned` (see BadgeResolverService.resolveLevelMap), but it also never
   * pretends the level was simply never attempted. See renderExpired below.
   */
  expired: CatalogEarned | null;
  discussion: CatalogDiscussionState | null;
  state: LevelState;
  unlocksAfterLevel: SkillLevelName | null;
  coveredByLevel: SkillLevelName | null;
}

/** 30 days is the conventional pre-lapse warning window. */
const EXPIRY_WARNING_DAYS = 30;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
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
/**
 * Same LIMIT_REACHED shape as app/assessments/[id]/page.tsx's LimitIssueBody
 * — this button hits the identical /assessment-sessions creation path, so
 * the same three metrics (retakeCooldownDays, retakesPerSkillLifetime,
 * assessments) can block it, and EntitlementLimitException carries no
 * `message` field for any of them (see apps/api). Kept as a plain function
 * rather than duplicating the take-flow page's full card-shaped rendering —
 * this button's error slot is a single-line ErrorState, not a whole page —
 * but the underlying bug it fixes is the same one: without this, `metric
 * === 'assessments'` fell through to the generic `(e as Error).message`
 * fallback, i.e. the raw "Request failed: 402" a candidate should never see.
 */
function describeLimitReached(
  body: { metric?: string; limit?: number | null; resetsAt?: string | null },
  tier: string | null,
): ReactNode {
  const resetDate = body.resetsAt ? new Date(body.resetsAt).toLocaleDateString() : null;
  if (body.metric === 'retakeCooldownDays') {
    return (
      <>
        You&apos;re in the cooldown period after your last attempt at this skill
        {resetDate && <> — available again on {resetDate}</>}.{' '}
        {tier !== 'PREMIUM' && <Link href="/upgrade">Premium removes retake cooldowns entirely →</Link>}
      </>
    );
  }
  if (body.metric === 'retakesPerSkillLifetime') {
    return (
      <>
        You&apos;ve used all {body.limit} retake{body.limit === 1 ? '' : 's'} allowed for this skill — this cap
        doesn&apos;t reset.{' '}
        {tier !== 'PREMIUM' && <Link href="/upgrade">Premium allows more retakes per skill →</Link>}
      </>
    );
  }
  if (body.metric === 'assessments') {
    return (
      <>
        You&apos;ve used all {body.limit} assessment start{body.limit === 1 ? '' : 's'} included on your plan this
        month{resetDate && <> — more open up on {resetDate}</>}.{' '}
        {tier !== 'PREMIUM' && <Link href="/upgrade">Premium removes the monthly cap entirely →</Link>}
      </>
    );
  }
  return 'This assessment format is not available right now.';
}

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
  const { tier } = useEntitlements();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<ReactNode>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const created = await api<{ session: { id: string } }>('/assessment-sessions', { method: 'POST' });
      router.push(`/assessments/discussion/session/${created.session.id}`);
    } catch (e) {
      // Disabling the button below is the UX courtesy; this catch is the
      // defense-in-depth path for a stale page or a race with a profile edit
      // in another tab — the server's PROFILE_INCOMPLETE_FOR_ASSESSMENT
      // message is already candidate-friendly, so surface it as-is.
      const body = (e as ApiError).body as
        | { code?: string; message?: string; metric?: string; limit?: number | null; resetsAt?: string | null }
        | undefined;
      if (body?.code === 'PROFILE_INCOMPLETE_FOR_ASSESSMENT' && body.message) {
        setError(body.message);
      } else if (body?.code === 'LIMIT_REACHED') {
        setError(describeLimitReached(body, tier));
      } else {
        setError((e as Error).message);
      }
      setStarting(false);
    }
  }

  if (!discussion) {
    return (
      <div>
        <button onClick={start} disabled={starting || !profileReady} title={profileReady ? undefined : 'Complete your profile to unlock'}>
          {starting ? 'Starting…' : namedChoice ? `Discussion · ${durationMins} min` : 'Start'}
        </button>
        {error && <ErrorState message={error} />}
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
        {error && <ErrorState message={error} />}
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
/**
 * Shared by both EARNED branches below — a plain "valid until" line, or a
 * warning once within EXPIRY_WARNING_DAYS of lapsing. A credential vanishing
 * with no notice is a bad experience, so this fires well before expiresAt
 * actually passes rather than only informing after the fact (at which
 * point the level would already have reverted to the `expired` branch in
 * LevelRow, not this one).
 */
function ExpiryMeta({ expiresAt }: { expiresAt: string }) {
  const days = daysUntil(expiresAt);
  const dateStr = new Date(expiresAt).toLocaleDateString();
  if (days <= EXPIRY_WARNING_DAYS) {
    return (
      <div className="meta assessment-expiry-warning">
        ⚠ Expires {dateStr} ({days <= 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}) — retake before
        then to keep this badge current.
      </div>
    );
  }
  return <div className="meta">Valid until {dateStr}.</div>;
}

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
          <ExpiryMeta expiresAt={level.earned.expiresAt} />
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
          <ExpiryMeta expiresAt={level.earned.expiresAt} />
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

  // AVAILABLE with a since-expired badge on record — same actions as the
  // plain-AVAILABLE case below (retaking is exactly how this gets renewed),
  // but says so honestly instead of rendering identically to "never
  // attempted." Expiry is not deletion: the old badge/verify link still
  // exists and still shows "expired" honestly on its own public page (see
  // /badges/[hash]) — this just surfaces that same history here too.
  if (level.expired) {
    return (
      <div className="assessment-row">
        <div className="assessment-info">
          <div className="assessment-row-header">
            <LevelHeading level={level.level} />
            <div className="assessment-actions">
              {test && (
                profileReady ? (
                  <Link href={`/assessments/${test.assessmentId}`}>
                    <button>{discussionFormat ? `Test · ${test.durationMins} min` : 'Retake'}</button>
                  </Link>
                ) : (
                  <button disabled title="Complete your profile to unlock">
                    {discussionFormat ? `Test · ${test.durationMins} min` : 'Retake'}
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
          <div className="meta assessment-expired">
            Previously earned {new Date(level.expired.issuedAt).toLocaleDateString()} — expired{' '}
            {new Date(level.expired.expiresAt).toLocaleDateString()}. Retake to renew this badge.
          </div>
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

/** EARNED and SUBSUMED are both "behind you, nothing to do here" states — the only two that get folded into the compact summary line. AVAILABLE (the "you are here" row) and LOCKED (what's ahead) always render in full, preserving the ladder's behind/ahead shape. */
const BEHIND_STATES = new Set<LevelState>(['EARNED', 'SUBSUMED']);

/**
 * One line replacing every EARNED/SUBSUMED row in a skill card — a
 * candidate holding L1+L2 doesn't need either row's full description and
 * provenance just to see they're done; expanding reveals the exact same
 * LevelRow markup (checkmark, verifiedBy, "covered by" text) this replaces,
 * so nothing about earned badges' detail is actually lost, just deferred
 * behind one click.
 */
function EarnedLevelsSummary({
  levels,
  expanded,
  onToggle,
}: {
  levels: CatalogLevel[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const labels = levels.map((l) => l.level).join(', ');
  // "complete" rather than "earned" — a SUBSUMED level (a grandfathered gap
  // covered by a higher badge) has no badge of its own, so calling it
  // "earned" would overclaim; "complete" is accurate for both states.
  return (
    <button type="button" className="assessment-earned-summary" onClick={onToggle} aria-expanded={expanded}>
      ✓ {labels} complete — {expanded ? 'Hide details' : 'Show details'}
    </button>
  );
}

/**
 * True only for a skill a FREE candidate could never start regardless of
 * level state — a different skill than the one their free plan is already
 * locked to. Skills the candidate already holds a badge in stay fully
 * visible either way (behindLevels/EarnedLevelsSummary above already
 * handles that), since a badge earned before or during a lock is never
 * revoked — this only gates *new* attempts, matching
 * EntitlementsService.checkSkillLockEligibility exactly. A UX courtesy
 * only: the server enforces the real rule (see that method) regardless of
 * whether this banner renders correctly.
 */
function SkillCard({
  skill,
  profileReady,
  freeSkillLocked,
}: {
  skill: CatalogSkill;
  profileReady: boolean;
  freeSkillLocked: { skillName: string } | null;
}) {
  const [showBehind, setShowBehind] = useState(false);
  const behindLevels = skill.levels.filter((l) => BEHIND_STATES.has(l.state));
  const aheadLevels = skill.levels.filter((l) => !BEHIND_STATES.has(l.state));

  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ marginBottom: 10 }}>
        <span className="eyebrow">{skill.domainName}</span>
        <div style={{ marginTop: 4 }}>
          <strong style={{ fontSize: '1.05rem' }}>{skill.skillName}</strong>
          {skill.description && <div className="meta">{skill.description}</div>}
        </div>
      </div>
      {behindLevels.length > 0 && (
        <EarnedLevelsSummary levels={behindLevels} expanded={showBehind} onToggle={() => setShowBehind((v) => !v)} />
      )}
      {behindLevels.length > 0 && showBehind &&
        behindLevels.map((level) => <LevelRow key={level.level} level={level} profileReady={profileReady} />)}
      {freeSkillLocked ? (
        <div className="assessment-row">
          <div className="assessment-info">
            <div className="meta">
              🔒 Your free plan&apos;s assessments are locked to <strong>{freeSkillLocked.skillName}</strong>.{' '}
              <Link href="/upgrade">Upgrade to Premium</Link> to attempt {skill.skillName} too.
            </div>
          </div>
        </div>
      ) : (
        aheadLevels.map((level) => <LevelRow key={level.level} level={level} profileReady={profileReady} />)
      )}
    </div>
  );
}

/** A skill counts toward a category's "earned" summary count once it holds at least one badge, at any level. */
function skillHasEarnedBadge(skill: CatalogSkill): boolean {
  return skill.levels.some((l) => l.earned !== null);
}

/** Earned-or-in-progress: has a badge, or has ever started a (resumable/in-review/rejected) discussion session — the only "in progress" signal the catalog exposes, since MCQ tests grade synchronously and leave no persisted in-progress state. */
function skillIsEarnedOrInProgress(skill: CatalogSkill): boolean {
  return skill.levels.some((l) => l.earned !== null || l.discussion !== null);
}

function CategorySection({
  domainName,
  skills,
  expanded,
  onToggle,
  profileReady,
  freeSkillLock,
}: {
  domainName: string;
  skills: CatalogSkill[];
  expanded: boolean;
  onToggle: () => void;
  profileReady: boolean;
  freeSkillLock: { skillId: string; skillName: string } | null;
}) {
  const earnedCount = skills.filter(skillHasEarnedBadge).length;
  return (
    <div className="assessment-category">
      <button type="button" className="assessment-category-header" onClick={onToggle} aria-expanded={expanded}>
        <span className="assessment-category-header-title">
          <span className={`assessment-category-chevron${expanded ? ' is-open' : ''}`} aria-hidden="true">▸</span>
          {domainName}
        </span>
        <span className="assessment-category-summary">
          {skills.length} skill{skills.length === 1 ? '' : 's'} · {earnedCount} earned
        </span>
      </button>
      {expanded && (
        <div className="assessment-category-body">
          {skills.map((skill) => (
            <SkillCard
              key={skill.skillId}
              skill={skill}
              profileReady={profileReady}
              freeSkillLocked={freeSkillLock && freeSkillLock.skillId !== skill.skillId ? freeSkillLock : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Domain-grouped view of the catalog, preserving each domain's first-seen order in the catalog response — the API has no explicit domain ordering of its own to defer to instead. */
function groupByDomain(skills: CatalogSkill[]): { domainName: string; skills: CatalogSkill[] }[] {
  const order: string[] = [];
  const byDomain = new Map<string, CatalogSkill[]>();
  for (const skill of skills) {
    if (!byDomain.has(skill.domainName)) {
      byDomain.set(skill.domainName, []);
      order.push(skill.domainName);
    }
    byDomain.get(skill.domainName)!.push(skill);
  }
  return order.map((domainName) => ({ domainName, skills: byDomain.get(domainName)! }));
}

function AssessmentsPageInner() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  const ready = useRequireAuth();
  const { usage, tier, limits, freeSkillLock } = useEntitlements();
  // Only meaningful once the restriction is actually in force for this
  // candidate's tier and they've already locked a skill — mirrors
  // TakeAssessmentPage's willLockFreeSkill / EntitlementsService.
  // checkSkillLockEligibility exactly, so this banner and the server's
  // actual rejection can never disagree about which skills are gated.
  const activeFreeSkillLock = tier === 'FREE' && limits?.singleSkillRestriction ? freeSkillLock : null;
  const [skills, setSkills] = useState<CatalogSkill[]>([]);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<{
    completeness: number;
    fullName: string | null;
    headline: string | null;
    yearsOfExp: number | null;
  } | null>(null);
  // null = not yet decided. Computed once, synchronously during render (see
  // below) rather than in an effect, so there's no visible flash of
  // "everything expanded" before it narrows down.
  const [expandedDomains, setExpandedDomains] = useState<Set<string> | null>(null);

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

  const categories = groupByDomain(skills);

  /**
   * Sensible default, computed once the catalog first has data: with only a
   * couple of categories there's nothing to gain from collapsing anything,
   * so expand all of them. With more, expand only the ones holding a skill
   * the candidate has earned or started — a returning candidate lands on
   * their own progress, not a wall of collapsed headers. A brand-new
   * candidate has nothing qualifying yet, so that would collapse
   * *everything* on a first visit; falls back to expanding all instead.
   */
  if (expandedDomains === null && categories.length > 0) {
    const withProgress = categories.filter((c) => c.skills.some(skillIsEarnedOrInProgress)).map((c) => c.domainName);
    const initial = categories.length <= 3 || withProgress.length === 0
      ? categories.map((c) => c.domainName)
      : withProgress;
    setExpandedDomains(new Set(initial));
  }

  function toggleDomain(domainName: string) {
    setExpandedDomains((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(domainName)) next.delete(domainName);
      else next.add(domainName);
      return next;
    });
  }

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
      <main className="container-standard">
        <h1>Assessments</h1>
        <EmployerInvitations />
        <p>
          Pass an assessment to earn a verified skill badge for your profile. Employers can see every badge
          you&apos;ve earned — and it&apos;s verified badges, not self-reported skills, that drive your job matches.
        </p>
        <p>
          Each skill has three levels — Foundational, Practitioner, and Advanced — each one more
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
        {error && <ErrorState message={error} />}
        {skills.length === 0 && !error && (
          <EmptyState message="No assessments are available just yet — check back soon.">
            <p className="meta" style={{ margin: '4px 0 0' }}>
              In the meantime, you can <Link href="/profile">add a verified credential</Link> on your
              profile to start applying.
            </p>
          </EmptyState>
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

        {categories.map((cat) => (
          <CategorySection
            key={cat.domainName}
            domainName={cat.domainName}
            skills={cat.skills}
            expanded={expandedDomains?.has(cat.domainName) ?? true}
            onToggle={() => toggleDomain(cat.domainName)}
            profileReady={profileReady}
            freeSkillLock={activeFreeSkillLock}
          />
        ))}
      </main>
    </>
  );
}

export default function AssessmentsPage() {
  return (
    <Suspense fallback={<main className="container-standard"><LoadingState /></main>}>
      <AssessmentsPageInner />
    </Suspense>
  );
}
