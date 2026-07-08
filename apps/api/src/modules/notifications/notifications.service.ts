import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_PROVIDER, EmailProvider } from './email-provider.interface';

/**
 * Sends a single notification email and records its lifecycle. This never
 * throws — a Resend outage or a bad address must never fail the request that
 * triggered the notification (an application, a status change, a cron run).
 * Logs are static strings only; email subjects/bodies carry candidate PII
 * (name, job title) and are never written to the log stream.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async sendEmail(
    userId: string,
    type: NotificationType,
    subject: string,
    html: string,
    jobIds: string[] = [],
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      });

      if (!user?.email) {
        this.logger.log(`Skipping ${type} notification — no email on file for this user`);
        return;
      }
      if (user.profile?.emailNotifications === false) {
        this.logger.log(`Skipping ${type} notification — user opted out of email`);
        return;
      }

      const notification = await this.prisma.notification.create({
        data: { userId, type, channel: 'EMAIL', subject, body: html, jobIds },
      });

      try {
        await this.emailProvider.send({ to: user.email, subject, html });
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        this.logger.log(`Sent ${type} notification`);
      } catch {
        await this.prisma.notification
          .update({ where: { id: notification.id }, data: { status: 'FAILED' } })
          .catch(() => undefined);
        this.logger.error(`Failed to send ${type} notification`);
      }
    } catch {
      this.logger.error(`Unexpected error queuing ${type} notification`);
    }
  }
}
