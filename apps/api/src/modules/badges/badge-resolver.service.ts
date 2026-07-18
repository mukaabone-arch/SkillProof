import { ForbiddenException, Injectable } from '@nestjs/common';
import { Badge, BadgeVerificationMethod, ClaimStatus, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SKILL_LEVEL as DISCUSSION_LEVEL, SKILL_NAME as DISCUSSION_SKILL_NAME } from '../assessment-sessions/rag-systems-l2.rubric';

/** Ascending level order — index comparison decides "highest level held". */
export const LEVEL_ORDER: SkillLevel[] = [SkillLevel.L1, SkillLevel.L2, SkillLevel.L3, SkillLevel.L4];

/**
 * Per-level unlock status for strict sequential leveling: a candidate may
 * only attempt the one level immediately after their highest earned level
 * in a skill. Computed over a skill's own *offered* levels (see
 * deriveLevelStates), never the abstract L1-L4 ladder — a skill that only
 * offers L2 (e.g. RAG Systems today) has L2 AVAILABLE to a fresh candidate,
 * not permanently LOCKED behind a nonexistent L1.
 */
export type LevelState = 'EARNED' | 'SUBSUMED' | 'AVAILABLE' | 'LOCKED';

/**
 * offeredLevels must already be ascending LEVEL_ORDER order (a skill's
 * offered levels — see AssessmentsService.buildSkillBuckets, which filters
 * LEVEL_ORDER down to levels that actually have a live assessment/discussion
 * format). Priority: an individual badge at a level always wins as EARNED,
 * even below the highest earned level — SUBSUMED only covers a *gap* left
 * by an out-of-order badge (grandfathered), never overrides a level that
 * itself has its own badge. Pure and side-effect-free so it can be
 * unit-tested directly and reused identically by both the catalog display
 * (buildSkillBuckets) and attempt/session-creation enforcement
 * (assertLevelAvailable below) — the two can never disagree.
 */
export function deriveLevelStates(
  offeredLevels: SkillLevel[],
  levelMap: Partial<Record<SkillLevel, Badge>>,
): Map<SkillLevel, LevelState> {
  let highestEarnedIndex = -1;
  offeredLevels.forEach((level, i) => {
    if (levelMap[level]) highestEarnedIndex = i;
  });
  const states = new Map<SkillLevel, LevelState>();
  offeredLevels.forEach((level, i) => {
    if (levelMap[level]) states.set(level, 'EARNED');
    else if (i < highestEarnedIndex) states.set(level, 'SUBSUMED');
    else if (i === highestEarnedIndex + 1) states.set(level, 'AVAILABLE');
    else states.set(level, 'LOCKED');
  });
  return states;
}

const VERIFICATION_PRECEDENCE: Record<BadgeVerificationMethod, number> = {
  [BadgeVerificationMethod.DISCUSSION]: 1,
  [BadgeVerificationMethod.TEST]: 0,
};

/**
 * Single source of truth for "which Badge counts, for a given user+skill
 * (+level)". This can't be enforced at write time: every passing attempt or
 * discussion session mints its own permanent Badge row (see the model's own
 * doc comment), so a user+skill+level can accumulate more than one — a TEST
 * pass and, before or after it, a DISCUSSION pass. Precedence is
 * DISCUSSION > TEST, tie-broken by most recent issuance. A later *weaker*
 * proof never displaces a stronger one already held, because callers always
 * re-resolve from the full set of non-revoked badges rather than tracking a
 * running "current best" anywhere that a weaker write could clobber.
 *
 * Every mint path (AssessmentsService.issueBadge, ReviewService.issueBadge)
 * and every read path that needs "the candidate's current standing for
 * skill X" (the assessments catalog, SkillClaim sync) goes through this
 * service — the comparison itself must never be reimplemented per surface.
 */
@Injectable()
export class BadgeResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Picks the strongest badge among a set already known to share one skill+level. */
  private pickBest(badges: Badge[]): Badge {
    return badges.reduce((best, candidate) => {
      const byMethod = VERIFICATION_PRECEDENCE[candidate.verifiedBy] - VERIFICATION_PRECEDENCE[best.verifiedBy];
      if (byMethod !== 0) return byMethod > 0 ? candidate : best;
      return candidate.issuedAt > best.issuedAt ? candidate : best;
    });
  }

  /**
   * All non-revoked badges a user holds for one skill, grouped by level and
   * collapsed to the single strongest badge per level via pickBest. Levels
   * with no non-revoked badge at all are simply absent from the result.
   */
  async resolveLevelMap(userId: string, skillId: string): Promise<Partial<Record<SkillLevel, Badge>>> {
    const badges = await this.prisma.badge.findMany({
      where: { userId, skillId, revokedAt: null },
    });

    const byLevel = new Map<SkillLevel, Badge[]>();
    for (const b of badges) {
      const list = byLevel.get(b.level) ?? [];
      list.push(b);
      byLevel.set(b.level, list);
    }

    const result: Partial<Record<SkillLevel, Badge>> = {};
    for (const [level, list] of byLevel) {
      result[level] = this.pickBest(list);
    }
    return result;
  }

  /**
   * The single badge that should back SkillClaim — the highest level held
   * for this skill across any format, with resolveLevelMap already having
   * resolved verification-method precedence at that level.
   */
  async resolveCurrentClaim(userId: string, skillId: string): Promise<{ level: SkillLevel; badge: Badge } | null> {
    const levelMap = await this.resolveLevelMap(userId, skillId);
    for (let i = LEVEL_ORDER.length - 1; i >= 0; i--) {
      const level = LEVEL_ORDER[i];
      const badge = levelMap[level];
      if (badge) return { level, badge };
    }
    return null;
  }

  /**
   * A skill's live offered levels (ascending) plus its display name — one
   * extra pair of queries, fine at attempt/session-start granularity (as
   * opposed to the bulk catalog path, which already has this from its own
   * bulk query and never calls this method). Folds in the discussion
   * format's level exactly like buildSkillBuckets does, so a skill offered
   * only via the discussion flow (RAG Systems L2 today) isn't missed.
   */
  private async getOfferedLevelsAndName(skillId: string): Promise<{ skillName: string; offeredLevels: SkillLevel[] }> {
    const skill = await this.prisma.skill.findUniqueOrThrow({ where: { id: skillId } });
    const assessments = await this.prisma.assessment.findMany({
      where: { skillId, isLive: true },
      select: { targetLevel: true },
    });
    const levels = new Set<SkillLevel>(assessments.map((a) => a.targetLevel));
    if (skill.name === DISCUSSION_SKILL_NAME) levels.add(DISCUSSION_LEVEL);
    return { skillName: skill.name, offeredLevels: LEVEL_ORDER.filter((l) => levels.has(l)) };
  }

  /**
   * Server-side enforcement of strict sequential leveling — UI hiding the
   * Start button alone is not enforcement. Throws a plain-string
   * ForbiddenException (the house style for 403s throughout this codebase;
   * no other 403 here uses an object payload) unless targetLevel is
   * currently AVAILABLE for this user. Called from both
   * AssessmentsService.startAttempt (MCQ) and
   * AssessmentSessionsService.createSession (discussion) — the one place
   * this rule is expressed, so the two flows can't drift apart.
   */
  async assertLevelAvailable(userId: string, skillId: string, targetLevel: SkillLevel): Promise<void> {
    const { skillName, offeredLevels } = await this.getOfferedLevelsAndName(skillId);
    const levelMap = await this.resolveLevelMap(userId, skillId);
    const states = deriveLevelStates(offeredLevels, levelMap);
    const state = states.get(targetLevel);
    if (state === 'AVAILABLE') return;

    if (state === 'EARNED') {
      throw new ForbiddenException(`You've already earned ${skillName} ${targetLevel}.`);
    }
    if (state === 'SUBSUMED') {
      const coveredBy = [...offeredLevels].reverse().find((l) => states.get(l) === 'EARNED');
      throw new ForbiddenException(`${skillName} ${targetLevel} is already covered by your ${skillName} ${coveredBy} badge.`);
    }
    // LOCKED (or, defensively, a level this skill doesn't even offer).
    const availableLevel = offeredLevels.find((l) => states.get(l) === 'AVAILABLE');
    throw new ForbiddenException(
      availableLevel ? `Complete ${skillName} ${availableLevel} first.` : `${skillName} ${targetLevel} isn't available yet.`,
    );
  }

  /**
   * Recomputes and upserts SkillClaim after a new Badge is minted — the
   * only place SkillClaim.level/badgeId are ever written. Both mint paths
   * call this instead of upserting to whatever was just issued, so a later
   * weaker proof (by level or by verification method) can never overwrite a
   * stronger one this resolver would still pick.
   */
  async syncSkillClaim(userId: string, skillId: string): Promise<void> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) return;

    const current = await this.resolveCurrentClaim(userId, skillId);
    if (!current) return;

    await this.prisma.skillClaim.upsert({
      where: { profileId_skillId: { profileId: profile.id, skillId } },
      update: { status: ClaimStatus.VERIFIED, level: current.level, badgeId: current.badge.id },
      create: {
        profileId: profile.id,
        skillId,
        level: current.level,
        status: ClaimStatus.VERIFIED,
        badgeId: current.badge.id,
      },
    });
  }
}
