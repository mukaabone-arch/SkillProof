import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, OrgType, ShortlistStage, StaffingSubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatLocation } from '../locations/location-format.util';
import { ProfilesService } from '../profiles/profiles.service';
import { ShortlistPipelineService } from '../shortlist/shortlist-pipeline.service';
import { StaffingSubmissionsService } from '../staffing/staffing-submissions.service';
import { effectiveSubmissionStatus } from '../staffing/staffing-representation.util';
import { CandidatePackageService } from '../webhooks/candidate-package.service';
import { PipelineActionDto } from './integrations.dto';

export const PAGE_MAX = 100;

export interface ListQuery {
  updatedSince?: string;
  limit?: string;
  jobId?: string;
  status?: string;
}

/**
 * The org's own systems (an ATS, a script) read and update MyAmbii with an
 * API key. Same data and rules as the portal: the same candidate package
 * as webhooks, and writes go through the portal's own services, so every
 * notification and pipeline rule still applies.
 *
 * Lists are ordered by updatedAt (oldest first) and filtered with
 * ?updatedSince=<ISO time>; a full page returns `next`, the updatedSince
 * for the following page (it repeats the last item, so de-duplicate by id).
 */
@Injectable()
export class ApiV1Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: CandidatePackageService,
    private readonly profiles: ProfilesService,
    private readonly pipeline: ShortlistPipelineService,
    private readonly submissions: StaffingSubmissionsService,
  ) {}

  async jobs(orgId: string, q: ListQuery) {
    const { since, take } = page(q);
    const status = q.status ? (Object.values(JobStatus).includes(q.status as JobStatus) ? (q.status as JobStatus) : bad('status must be DRAFT, LIVE or CLOSED')) : undefined;
    const rows = await this.prisma.job.findMany({
      where: { orgId, ...(status ? { status } : {}), ...(since ? { updatedAt: { gte: since } } : {}) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take,
      include: {
        skills: { include: { skill: { select: { name: true } } } },
        postedForClient: { select: { id: true, name: true } },
        projectRole: { select: { id: true, projectId: true, headcount: true } },
      },
    });
    return pageOf(rows.map((j) => ({
      id: j.id,
      code: j.code,
      title: j.title,
      status: j.status,
      description: j.description,
      employmentType: j.employmentType,
      location: formatLocation(j),
      remote: j.remote,
      experienceMin: j.experienceMin,
      experienceMax: j.experienceMax,
      salary: j.salaryNotDisclosed ? null : { min: j.salaryMin, max: j.salaryMax, currency: j.salaryCurrency },
      skills: j.skills.map((s) => ({ skill: s.skill.name, requiredLevel: s.requiredLevel, required: s.isRequired })),
      client: j.postedForClient,
      projectRole: j.projectRole,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    })), take);
  }

  async applicants(orgId: string, q: ListQuery) {
    const { since, take } = page(q);
    const rows = await this.prisma.application.findMany({
      where: { job: { orgId }, ...(q.jobId ? { jobId: q.jobId } : {}), ...(since ? { updatedAt: { gte: since } } : {}) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take,
      include: { job: { select: { id: true, code: true, title: true } } },
    });
    const data = [];
    for (const a of rows) {
      data.push({
        id: a.id,
        status: a.status,
        job: a.job,
        appliedAt: a.createdAt,
        updatedAt: a.updatedAt,
        candidate: await this.packages.build(orgId, a.candidateProfileId).catch(() => null),
      });
    }
    return pageOf(data, take);
  }

  /** Employers: shortlist entries and their stage. Recruiters: submissions to clients and their status. */
  async pipelineList(orgId: string, orgType: OrgType, q: ListQuery) {
    const { since, take } = page(q);
    if (orgType === OrgType.STAFFING) {
      const rows = await this.prisma.staffingSubmission.findMany({
        where: { orgId, ...(since ? { updatedAt: { gte: since } } : {}) },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
        include: { client: { select: { id: true, name: true } } },
      });
      const now = new Date();
      const data = [];
      for (const s of rows) {
        data.push({
          id: s.id,
          type: 'submission',
          status: effectiveSubmissionStatus(s, now),
          roleTitle: s.roleTitle,
          client: s.client,
          projectRoleId: s.projectRoleId,
          consentExpiresAt: s.consentExpiresAt,
          candidateNote: s.candidateNote,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          candidate: await this.packages.build(orgId, s.candidateId).catch(() => null),
        });
      }
      return pageOf(data, take);
    }
    const rows = await this.prisma.shortlistEntry.findMany({
      where: { orgId, ...(q.jobId ? { jobId: q.jobId } : {}), ...(since ? { updatedAt: { gte: since } } : {}) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take,
      include: { job: { select: { id: true, code: true, title: true } } },
    });
    const data = [];
    for (const e of rows) {
      data.push({
        id: e.id,
        type: 'shortlist',
        stage: e.stage,
        job: e.job,
        candidateResponse: e.candidateResponse,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        candidate: await this.packages.build(orgId, e.candidateId).catch(() => null),
      });
    }
    return pageOf(data, take);
  }

  async candidate(orgId: string, orgType: OrgType, candidateId: string) {
    const rel = await this.packages.relationship(orgId, candidateId, orgType === OrgType.STAFFING);
    if (!rel.known) throw new NotFoundException('Candidate not found');
    return this.packages.build(orgId, candidateId);
  }

  /** The resume PDF — only for candidates who applied to this org (the portal's rule). */
  async resume(orgId: string, orgType: OrgType, candidateId: string) {
    const rel = await this.packages.relationship(orgId, candidateId, orgType === OrgType.STAFFING);
    if (!rel.applied) throw new ForbiddenException('The resume is shared only when the candidate applied to one of your jobs.');
    return this.profiles.getResumeForCandidate(candidateId);
  }

  async pipelineAction(orgId: string, orgType: OrgType, actorUserId: string, entryId: string, dto: PipelineActionDto) {
    if (orgType === OrgType.STAFFING) throw new ForbiddenException('Recruiters update submissions: POST /v1/submissions/:id/status.');
    switch (dto.action) {
      case 'invite':
        await this.pipeline.invite(orgId, entryId, { message: dto.message });
        break;
      case 'offer':
        await this.pipeline.offer(orgId, entryId);
        break;
      case 'hire':
        await this.pipeline.outcome(orgId, entryId, { outcome: ShortlistStage.HIRED });
        break;
      case 'close':
        await this.pipeline.outcome(orgId, entryId, { outcome: ShortlistStage.CLOSED });
        break;
      case 'reject':
        await this.pipeline.reject(orgId, actorUserId, entryId, { reason: dto.reason });
        break;
    }
    const e = await this.prisma.shortlistEntry.findUnique({ where: { id: entryId }, select: { id: true, stage: true, updatedAt: true } });
    return e;
  }

  async submissionStatus(orgId: string, orgType: OrgType, id: string, status: StaffingSubmissionStatus) {
    if (orgType !== OrgType.STAFFING) throw new ForbiddenException('Employers update the shortlist: POST /v1/pipeline/:id/actions.');
    return this.submissions.updateStatus(orgId, id, status);
  }
}

function bad(message: string): never {
  throw new BadRequestException(message);
}

function page(q: ListQuery): { since: Date | null; take: number } {
  const take = q.limit ? Number(q.limit) : 50;
  if (!Number.isInteger(take) || take < 1 || take > PAGE_MAX) bad(`limit must be 1–${PAGE_MAX}`);
  let since: Date | null = null;
  if (q.updatedSince) {
    since = new Date(q.updatedSince);
    if (Number.isNaN(since.getTime())) bad('updatedSince must be an ISO 8601 time, e.g. 2026-11-20T00:00:00Z');
  }
  return { since, take };
}

function pageOf<T extends { updatedAt: Date }>(data: T[], take: number) {
  const last = data.at(-1);
  return { data, next: data.length === take && last ? { updatedSince: last.updatedAt.toISOString() } : null };
}

