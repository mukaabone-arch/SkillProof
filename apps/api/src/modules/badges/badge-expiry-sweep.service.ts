import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BadgeResolverService } from './badge-resolver.service';

/**
 * Catches passive expiry. BadgeResolverService.syncSkillClaim only ever
 * runs at mint time (a new badge being issued) — a claim whose only
 * backing badge quietly crosses its expiresAt with no new activity would
 * otherwise stay frozen at VERIFIED forever, since nothing else re-triggers
 * a sync for that candidate. Every downstream consumer that reads
 * SkillClaim.status directly instead of calling the resolver live
 * (matching, employer search, the apply-gate, applicant/shortlist views,
 * resume generation — see the badge-expiry feature's own audit for the
 * full list) depends on that status staying accurate over time, not just
 * at mint, which is what this sweep is for.
 *
 * Runs daily. A claim sitting VERIFIED-but-actually-expired for at most
 * ~24h is an acceptable window — nothing about the badge itself changes in
 * that gap (it's still genuinely the credential the candidate earned,
 * just not yet re-synced), and the public certificate page independently
 * computes `valid` from Badge.expiresAt directly on every request, so that
 * page is never stale regardless of this sweep's cadence.
 */
@Injectable()
export class BadgeExpirySweepService {
  private readonly logger = new Logger(BadgeExpirySweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: BadgeResolverService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    try {
      const { reevaluated } = await this.sweep();
      if (reevaluated > 0) this.logger.log(`Re-synced ${reevaluated} skill claim(s) with a newly-expired badge.`);
    } catch {
      this.logger.error('Badge expiry sweep failed');
    }
  }

  /** Separated from the @Cron handler so it can be invoked directly (e.g. manually or in a test) — same pattern as MatchDigestService.sendDigests. */
  async sweep(): Promise<{ reevaluated: number }> {
    const staleClaims = await this.prisma.skillClaim.findMany({
      where: { status: ClaimStatus.VERIFIED, badge: { expiresAt: { lte: new Date() } } },
      select: { profile: { select: { userId: true } }, skillId: true },
    });

    for (const claim of staleClaims) {
      // syncSkillClaim re-resolves from scratch rather than blindly setting
      // EXPIRED — a candidate can hold more than one badge per skill (see
      // BadgeResolverService's own top comment), so the badge that just
      // expired might not be the only one backing this claim's level; it
      // may re-resolve to still-VERIFIED against a different one. "reevaluated"
      // counts claims this sweep looked at, not necessarily ones it demoted.
      await this.resolver.syncSkillClaim(claim.profile.userId, claim.skillId);
    }
    return { reevaluated: staleClaims.length };
  }
}
