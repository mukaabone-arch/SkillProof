import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { CreateJobDto, JobSkillItemDto, UpdateJobDto } from './jobs.dto';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  create(orgId: string, dto: CreateJobDto) {
    return this.prisma.job.create({ data: { orgId, ...dto } });
  }

  listForOrg(orgId: string) {
    return this.prisma.job.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { skills: { include: { skill: true } } },
    });
  }

  async update(orgId: string, jobId: string, dto: UpdateJobDto) {
    await this.getOwnedJob(orgId, jobId);
    return this.prisma.job.update({ where: { id: jobId }, data: dto });
  }

  async setSkills(orgId: string, jobId: string, items: JobSkillItemDto[]) {
    await this.getOwnedJob(orgId, jobId);

    const skillIds = items.map((i) => i.skillId);
    if (skillIds.length > 0) {
      const validCount = await this.prisma.skill.count({ where: { id: { in: skillIds } } });
      if (validCount !== new Set(skillIds).size) {
        throw new BadRequestException('One or more skillId values do not exist.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.jobSkill.deleteMany({ where: { jobId } });
      if (items.length > 0) {
        await tx.jobSkill.createMany({
          data: items.map((i) => ({
            jobId,
            skillId: i.skillId,
            requiredLevel: i.requiredLevel,
            isRequired: i.isRequired,
          })),
        });
      }
      return tx.jobSkill.findMany({ where: { jobId }, include: { skill: true } });
    });
  }

  async parseDescription(description: string) {
    const skills = await this.prisma.skill.findMany({
      select: { name: true },
      orderBy: { name: 'asc' },
    });
    return this.llm.extractJobFields(description, skills.map((s) => s.name));
  }

  /** IDOR protection: employers may only touch jobs in their own org. */
  private async getOwnedJob(orgId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.orgId !== orgId) throw new ForbiddenException();
    return job;
  }
}
