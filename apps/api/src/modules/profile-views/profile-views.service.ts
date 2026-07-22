import { Injectable } from '@nestjs/common';
import { ProfileViewSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PLANS } from '../../config/plans.config';
import { EntitlementsService } from '../entitlements/entitlements.service';

/** One row per (employerId, candidateId, source) per rolling window — see record's own doc comment. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ProfileViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Recorded regardless of the candidate's tier (see ProfileView's own doc
   * comment in schema.prisma) — only *display* is gated. Deduped to at most
   * one row per (employerId, candidateId, source) per rolling 24h window: a
   * check-then-insert, not a DB-enforced constraint, since this is a
   * counting/display feature, not a hard limit — unlike
   * EntitlementsService.checkAndIncrement, a small race under concurrent
   * double-clicks (two rows instead of one) is an acceptable, low-stakes
   * trade-off here, not a correctness bug worth a transaction for.
   */
  async record(candidateId: string, employerId: string, source: ProfileViewSource): Promise<void> {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const existing = await this.prisma.profileView.findFirst({
      where: { candidateId, employerId, source, viewedAt: { gte: since } },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.profileView.create({ data: { candidateId, employerId, source } });
  }

  /**
   * GET /profiles/me/viewers. FREE sees a bare count; PREMIUM sees who (by
   * org) and when — gated by PLANS[tier].profileViewers, resolved the same
   * server-side-only way every other entitlement is (see
   * EntitlementsService.getEffectiveTier). Rows exist for every tier from
   * the moment they're viewed (see record) — an upgrade only changes what's
   * *shown*, never what's been collected, so a newly-PREMIUM candidate sees
   * their real history immediately.
   */
  async getViewersForCandidate(userId: string) {
    const [candidateId, tier] = await Promise.all([
      this.ensureProfileId(userId),
      this.entitlements.getEffectiveTier(userId),
    ]);
    const mode = PLANS[tier].profileViewers;

    if (mode === 'count_only') {
      const count = await this.prisma.profileView.count({ where: { candidateId } });
      return { tier, mode, count };
    }

    const views = await this.prisma.profileView.findMany({
      where: { candidateId },
      orderBy: { viewedAt: 'desc' },
      include: { employer: { include: { orgMembership: { include: { organization: true } } } } },
    });

    return {
      tier,
      mode,
      viewers: views.map((v) => ({
        viewedAt: v.viewedAt,
        source: v.source,
        // Org name only — never the specific employer's name/email, a
        // privacy line similar to ExternalCredential's nameMatchState never
        // exposing raw holder identity beyond what the feature needs.
        orgName: v.employer.orgMembership?.organization.name ?? null,
      })),
    };
  }

  private async ensureProfileId(userId: string): Promise<string> {
    const existing = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (existing) return existing.id;
    const created = await this.prisma.candidateProfile.create({ data: { userId }, select: { id: true } });
    return created.id;
  }
}
