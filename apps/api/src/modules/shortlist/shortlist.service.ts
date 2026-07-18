import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimStatus, Prisma, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AddShortlistEntryDto, UpdateShortlistEntryDto } from './shortlist.dto';

const shortlistEntryInclude = {
  candidateProfile: {
    include: { skillClaims: { where: { status: ClaimStatus.VERIFIED }, include: { skill: true, badge: true } } },
  },
  job: { select: { id: true, title: true } },
} satisfies Prisma.ShortlistEntryInclude;

type ShortlistEntryWithRelations = Prisma.ShortlistEntryGetPayload<{ include: typeof shortlistEntryInclude }>;

@Injectable()
export class ShortlistService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent-ish: adding the same (orgId, candidateId, jobId) triple a
   * second time just returns the existing row rather than erroring — a
   * "Shortlist" button re-clicked by mistake, or clicked from two tabs,
   * shouldn't 409. Note is only set on first add; re-adding never
   * overwrites an existing note (use PATCH for that).
   *
   * Split into two paths because Prisma's compound-unique input for
   * (orgId, candidateId, jobId) requires jobId to be a non-null string —
   * it won't build a WHERE for jobId IS NULL via that shorthand, since
   * Postgres itself doesn't treat NULL as participating in uniqueness (see
   * the @@unique doc comment on ShortlistEntry). The jobId-present path
   * uses a real upsert (atomic). The general (no jobId) path falls back to
   * findFirst-then-create, which has a narrow race window on a genuine
   * double-submit — an accepted gap given the underlying DB constraint has
   * the same one for null jobId.
   */
  async add(orgId: string, userId: string, dto: AddShortlistEntryDto) {
    if (dto.jobId) {
      await this.getOwnedJob(orgId, dto.jobId);
      const entry = await this.prisma.shortlistEntry.upsert({
        where: { orgId_candidateId_jobId: { orgId, candidateId: dto.candidateId, jobId: dto.jobId } },
        update: {},
        create: { orgId, candidateId: dto.candidateId, jobId: dto.jobId, addedByUserId: userId, note: dto.note },
      });
      return this.toView(entry.id);
    }

    const existing = await this.prisma.shortlistEntry.findFirst({
      where: { orgId, candidateId: dto.candidateId, jobId: null },
    });
    const entry =
      existing ??
      (await this.prisma.shortlistEntry.create({
        data: { orgId, candidateId: dto.candidateId, jobId: null, addedByUserId: userId, note: dto.note },
      }));
    return this.toView(entry.id);
  }

  async remove(orgId: string, id: string): Promise<{ id: string }> {
    await this.getOwnedEntry(orgId, id);
    await this.prisma.shortlistEntry.delete({ where: { id } });
    return { id };
  }

  async update(orgId: string, id: string, dto: UpdateShortlistEntryDto) {
    await this.getOwnedEntry(orgId, id);
    const updated = await this.prisma.shortlistEntry.update({ where: { id }, data: { note: dto.note } });
    return this.toView(updated.id);
  }

  /**
   * Same candidate-summary shape as JobsService.getApplicants /
   * MatchingService.getMatches / CandidatesService.search — verified skill
   * claims with a badge to link to, nothing unverified, so the shortlist
   * view can render without a second per-candidate fetch.
   */
  async list(orgId: string, jobId?: string, stage?: ShortlistStage) {
    const entries = await this.prisma.shortlistEntry.findMany({
      where: { orgId, ...(jobId ? { jobId } : {}), ...(stage ? { stage } : {}) },
      orderBy: { createdAt: 'desc' },
      include: shortlistEntryInclude,
    });

    return entries.map((e) => this.present(e));
  }

  private async toView(id: string) {
    const entry = await this.prisma.shortlistEntry.findUniqueOrThrow({
      where: { id },
      include: shortlistEntryInclude,
    });
    return this.present(entry);
  }

  private present(entry: ShortlistEntryWithRelations) {
    return {
      id: entry.id,
      candidateId: entry.candidateId,
      fullName: entry.candidateProfile.fullName,
      headline: entry.candidateProfile.headline,
      verifiedSkills: entry.candidateProfile.skillClaims
        .filter((c) => c.badge)
        .map((c) => ({
          skillId: c.skillId,
          skillName: c.skill.name,
          level: c.level,
          verifiedBy: c.badge!.verifiedBy,
          verifyHash: c.badge!.verifyHash,
        })),
      job: entry.job,
      stage: entry.stage,
      note: entry.note,
      addedByUserId: entry.addedByUserId,
      createdAt: entry.createdAt,
    };
  }

  /** IDOR protection: employers may only touch shortlist entries in their own org. Same pattern as JobsService.getOwnedJob. */
  private async getOwnedEntry(orgId: string, id: string) {
    const entry = await this.prisma.shortlistEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Shortlist entry not found');
    if (entry.orgId !== orgId) throw new ForbiddenException();
    return entry;
  }

  /** Same IDOR check as JobsService.getOwnedJob — a jobId from another org can't be attached to a shortlist entry. */
  private async getOwnedJob(orgId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.orgId !== orgId) throw new ForbiddenException();
    return job;
  }
}
