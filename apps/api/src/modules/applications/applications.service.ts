import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus, NotificationType, ProfileViewSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileViewsService } from '../profile-views/profile-views.service';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly profileViews: ProfileViewsService,
  ) {}

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

  /** Employer-facing: IDOR protection via the job's orgId, same pattern as JobsService.getOwnedJob. */
  async updateStatus(orgId: string, employerUserId: string, applicationId: string, status: ApplicationStatus) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: { select: { orgId: true } },
        candidateProfile: { select: { userId: true } },
      },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (application.job.orgId !== orgId) throw new ForbiddenException();

    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: { status },
      include: { job: { select: { title: true, organization: { select: { name: true } } } } },
    });
    await this.profileViews.record(application.candidateProfileId, employerUserId, ProfileViewSource.STATUS_CHANGE);

    try {
      const subject = `Your application to ${updated.job.title} was updated`;
      const html =
        `<p>Your application to <strong>${updated.job.title}</strong> at ` +
        `<strong>${updated.job.organization.name}</strong> is now <strong>${status}</strong>.</p>`;
      await this.notifications.sendEmail(
        application.candidateProfile.userId,
        NotificationType.APPLICATION_STATUS,
        subject,
        html,
      );
    } catch {
      // NotificationsService already swallows its own errors; this catch is defense in depth.
    }

    return updated;
  }
}
