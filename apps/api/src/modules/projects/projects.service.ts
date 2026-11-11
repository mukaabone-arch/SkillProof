import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { HiringProjectStatus, JobStatus, Prisma, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { formatLocation } from '../locations/location-format.util';
import { postingBlockers } from '../jobs/import/job-csv';
import { JobImportService } from '../jobs/import/job-import.service';
import { AddRoleDto, CreateProjectDto, UpdateProjectDto, UpdateRoleDto } from './projects.dto';

/** Pipeline stages that count as "in progress" for a role (Hired counts as hired). */
export const IN_PROGRESS_STAGES: ShortlistStage[] = [ShortlistStage.INVITED, ShortlistStage.INTERVIEWING, ShortlistStage.OFFER];

export interface RoleCounts {
  hired: number;
  inProgress: number;
}

/**
 * Hiring projects for employers (phase 1 of the spec; recruiter client
 * projects come later). A project lists roles; each role is one existing
 * job (ProjectRole.jobId is unique), created and posted through the normal
 * job screens. Headcount progress is counted from each job's shortlist
 * pipeline on every read, never stored, so it can't drift from the
 * pipeline the employer actually works in.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobImport: JobImportService,
  ) {}

  async list(orgId: string, includeArchived = false) {
    const projects = await this.prisma.hiringProject.findMany({
      where: { orgId, ...(includeArchived ? {} : { status: { not: HiringProjectStatus.ARCHIVED } }) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { roles: { select: { jobId: true, headcount: true, targetStartDate: true, job: { select: { status: true } } } } },
    });
    const counts = await this.countsByJob(projects.flatMap((p) => p.roles.map((r) => r.jobId)));
    const today = startOfToday();
    return projects.map((p) => {
      const roles = p.roles.map((r) => ({ ...r, ...(counts.get(r.jobId) ?? zero()) }));
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status,
        roleCount: roles.length,
        ...totals(roles),
        openRoles: roles.filter((r) => r.hired < r.headcount).length,
        lateRoles: roles.filter((r) => isLate(r, today)).length,
      };
    });
  }

  async create(orgId: string, userId: string, dto: CreateProjectDto) {
    assertDateOrder(dto.startDate, dto.endDate);
    return this.prisma.hiringProject.create({
      data: {
        orgId,
        createdByUserId: userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });
  }

  async get(orgId: string, id: string) {
    const project = await this.prisma.hiringProject.findFirst({
      where: { id, orgId },
      include: {
        roles: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            job: {
              select: {
                id: true,
                code: true,
                title: true,
                status: true,
                remote: true,
                locationCity: true,
                locationRegion: true,
                locationCountry: true,
                locationLegacy: true,
                skills: { select: { isRequired: true } },
              },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found.');
    const counts = await this.countsByJob(project.roles.map((r) => r.jobId));
    const today = startOfToday();
    const roles = project.roles.map((r) => {
      const c = counts.get(r.jobId) ?? zero();
      return {
        id: r.id,
        jobId: r.jobId,
        code: r.job.code,
        title: r.job.title,
        jobStatus: r.job.status,
        location: r.job.remote && !r.job.locationCity ? 'Remote' : formatLocation(r.job),
        headcount: r.headcount,
        targetStartDate: r.targetStartDate,
        sortOrder: r.sortOrder,
        hired: c.hired,
        inProgress: c.inProgress,
        filled: c.hired >= r.headcount,
        late: isLate({ ...r, ...c }, today),
        blockers: r.job.status === JobStatus.DRAFT ? postingBlockers(r.job) : [],
      };
    });
    const { roles: _r, ...rest } = project;
    return { ...rest, roles, ...totals(roles), openRoles: roles.filter((r) => !r.filled).length };
  }

  async update(orgId: string, id: string, dto: UpdateProjectDto) {
    const project = await this.owned(orgId, id);
    const start = dto.startDate !== undefined ? dto.startDate : project.startDate?.toISOString() ?? null;
    const end = dto.endDate !== undefined ? dto.endDate : project.endDate?.toISOString() ?? null;
    assertDateOrder(start, end);
    return this.prisma.hiringProject.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
  }

  /** Adds an existing job of this org as a role. A job can be in one project only. */
  async addRole(orgId: string, projectId: string, dto: AddRoleDto) {
    const project = await this.owned(orgId, projectId);
    if (project.status === HiringProjectStatus.ARCHIVED) throw new BadRequestException('Restore the project before adding roles.');
    const job = await this.prisma.job.findFirst({ where: { id: dto.jobId, orgId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found.');
    const last = await this.prisma.projectRole.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    try {
      return await this.prisma.projectRole.create({
        data: {
          projectId,
          jobId: job.id,
          headcount: dto.headcount,
          targetStartDate: dto.targetStartDate ? new Date(dto.targetStartDate) : null,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This job is already a role in a project.');
      }
      throw err;
    }
  }

  async updateRole(orgId: string, projectId: string, roleId: string, dto: UpdateRoleDto) {
    await this.ownedRole(orgId, projectId, roleId);
    return this.prisma.projectRole.update({
      where: { id: roleId },
      data: {
        ...(dto.headcount !== undefined ? { headcount: dto.headcount } : {}),
        ...(dto.targetStartDate !== undefined ? { targetStartDate: dto.targetStartDate ? new Date(dto.targetStartDate) : null } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
  }

  /** Takes the role out of the project; its job and pipeline are untouched. */
  async removeRole(orgId: string, projectId: string, roleId: string) {
    await this.ownedRole(orgId, projectId, roleId);
    await this.prisma.projectRole.delete({ where: { id: roleId } });
    return { ok: true };
  }

  /** Posts every draft role that's ready, with the same rules as bulk import. */
  async publishReady(orgId: string, projectId: string) {
    await this.owned(orgId, projectId);
    const drafts = await this.prisma.projectRole.findMany({
      where: { projectId, job: { status: JobStatus.DRAFT } },
      select: { jobId: true },
    });
    if (!drafts.length) return { published: [], skipped: [] };
    return this.jobImport.publish(orgId, drafts.map((d) => d.jobId));
  }

  /** hired / in-progress per job, from the shortlist pipeline. */
  async countsByJob(jobIds: string[]): Promise<Map<string, RoleCounts>> {
    const out = new Map<string, RoleCounts>();
    if (!jobIds.length) return out;
    const groups = await this.prisma.shortlistEntry.groupBy({
      by: ['jobId', 'stage'],
      where: { jobId: { in: jobIds }, stage: { in: [ShortlistStage.HIRED, ...IN_PROGRESS_STAGES] } },
      _count: { _all: true },
    });
    for (const g of groups) {
      if (!g.jobId) continue;
      const c = out.get(g.jobId) ?? zero();
      if (g.stage === ShortlistStage.HIRED) c.hired += g._count._all;
      else c.inProgress += g._count._all;
      out.set(g.jobId, c);
    }
    return out;
  }

  private async owned(orgId: string, id: string) {
    const p = await this.prisma.hiringProject.findFirst({ where: { id, orgId } });
    if (!p) throw new NotFoundException('Project not found.');
    return p;
  }

  private async ownedRole(orgId: string, projectId: string, roleId: string) {
    const r = await this.prisma.projectRole.findFirst({ where: { id: roleId, projectId, project: { orgId } } });
    if (!r) throw new NotFoundException('Role not found.');
    return r;
  }
}

const zero = (): RoleCounts => ({ hired: 0, inProgress: 0 });

function totals(roles: { headcount: number; hired: number; inProgress: number }[]) {
  return {
    headcount: roles.reduce((a, r) => a + r.headcount, 0),
    // Over-hiring one role doesn't make up for another: cap each at its headcount.
    hired: roles.reduce((a, r) => a + Math.min(r.hired, r.headcount), 0),
    inProgress: roles.reduce((a, r) => a + r.inProgress, 0),
  };
}

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Target start has passed and the role still isn't filled. */
function isLate(r: { targetStartDate: Date | null; hired: number; headcount: number }, today: Date): boolean {
  return !!r.targetStartDate && r.targetStartDate < today && r.hired < r.headcount;
}

function assertDateOrder(start?: string | null, end?: string | null) {
  if (start && end && new Date(start) > new Date(end)) {
    throw new BadRequestException('The end date is before the start date.');
  }
}
