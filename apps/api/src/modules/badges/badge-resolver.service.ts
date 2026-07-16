import { Injectable } from '@nestjs/common';
import { Badge, BadgeVerificationMethod, ClaimStatus, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Ascending level order — index comparison decides "highest level held". */
export const LEVEL_ORDER: SkillLevel[] = [SkillLevel.L1, SkillLevel.L2, SkillLevel.L3, SkillLevel.L4];

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
