import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClaimStatus, Prisma, ProfileViewSource, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProfileViewsService } from '../profile-views/profile-views.service';
import { AddShortlistEntryDto, UpdateShortlistEntryDto } from './shortlist.dto';

const shortlistEntryInclude = {
  candidateProfile: {
    include: { skillClaims: { where: { status: ClaimStatus.VERIFIED }, include: { skill: true, badge: true } } },
  },
  job: { select: { id: true, title: true } },
  // Full visibility for the employer view — unlike GET /interviews/mine
  // (InterviewsService.present), rounds here include `note` and the whole
  // history, not just the latest round.
  rounds: { orderBy: { roundNumber: 'asc' } },
} satisfies Prisma.ShortlistEntryInclude;

type ShortlistEntryWithRelations = Prisma.ShortlistEntryGetPayload<{ include: typeof shortlistEntryInclude }>;

@Injectable()
export class ShortlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileViews: ProfileViewsService,
  ) {}

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
    await this.profileViews.record(dto.candidateId, userId, ProfileViewSource.SHORTLIST);

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

  /** InterviewRound has no ON DELETE CASCADE on its FK (same convention as JobSkill→Job — see JobsService.remove) — rounds must go first or Postgres rejects the ShortlistEntry delete. */
  async remove(orgId: string, id: string): Promise<{ id: string }> {
    await this.getOwnedEntry(orgId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.interviewRound.deleteMany({ where: { shortlistEntryId: id } });
      await tx.shortlistEntry.delete({ where: { id } });
    });
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
      roleTitle: entry.candidateProfile.roleTitle,
      roleTitleOther: entry.candidateProfile.roleTitleOther,
      location: entry.candidateProfile.location,
      yearsOfExp: entry.candidateProfile.yearsOfExp,
      githubUrl: entry.candidateProfile.githubUrl,
      linkedinUrl: entry.candidateProfile.linkedinUrl,
      // Booleans only, never the raw key — same rule as everywhere else
      // (ProfilesService.withHasPhoto, JobsService.getApplicants). A "View
      // resume" affordance built from hasResume still needs a jobId to hit
      // GET /jobs/:jobId/applicants/:candidateId/resume — see that route's
      // employerCanViewCandidate check, which entry.job alone doesn't
      // guarantee (a jobId-less shortlist entry, or one added from search
      // for someone who never applied, can have hasResume true here but
      // still 403 there; that's intentional, not a bug in this list).
      hasPhoto: entry.candidateProfile.photoKey != null,
      hasResume: entry.candidateProfile.resumeS3Key != null,
      verifiedSkills: entry.candidateProfile.skillClaims
        .filter((c) => c.badge)
        .map((c) => ({
          skillId: c.skillId,
          skillName: c.skill.name,
          level: c.level,
          verifiedBy: c.badge!.verifiedBy,
          verifyHash: c.badge!.verifyHash,
          // Employer-facing credibility — null for session-issued badges (see Badge.attemptNumber's doc comment).
          attemptNumber: c.badge!.attemptNumber,
        })),
      job: entry.job,
      stage: entry.stage,
      note: entry.note,
      inviteMessage: entry.inviteMessage,
      rejectReason: entry.rejectReason,
      candidateResponse: entry.candidateResponse,
      rounds: entry.rounds,
      addedByUserId: entry.addedByUserId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
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
