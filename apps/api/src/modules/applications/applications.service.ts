import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) return [];

    const applications = await this.prisma.application.findMany({
      where: { candidateProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            employmentType: true,
            location: true,
            remote: true,
            organization: { select: { name: true } },
          },
        },
      },
    });

    return applications.map((a) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      job: {
        id: a.job.id,
        title: a.job.title,
        orgName: a.job.organization.name,
        employmentType: a.job.employmentType,
        location: a.job.location,
        remote: a.job.remote,
      },
    }));
  }
}
