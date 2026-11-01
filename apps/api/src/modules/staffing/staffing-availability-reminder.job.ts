import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AvailabilityStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderNotificationEmail } from '../notifications/notification-email.template';
import { candidateVisibilityFilter } from '../account/account.util';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { AVAILABILITY_FRESH_DAYS, REMINDER_LEAD_DAYS, reminderDue } from './staffing.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

/**
 * Emails an opted-in candidate REMINDER_LEAD_DAYS before their staffing
 * availability goes stale (after which StaffingService.search stops showing
 * them). One reminder per confirmation: availabilityReminderSentAt is
 * compared with availabilityConfirmedAt (see reminderDue), so confirming
 * again re-arms it. The mobile app shows the same prompt on Home. No push —
 * the app has no push infrastructure yet.
 */
@Injectable()
export class StaffingAvailabilityReminderJob {
  private readonly logger = new Logger(StaffingAvailabilityReminderJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 10 * * *', { timeZone: 'Asia/Kolkata' })
  async run(now = new Date()): Promise<number> {
    const dueBefore = new Date(now.getTime() - (AVAILABILITY_FRESH_DAYS - REMINDER_LEAD_DAYS) * DAY_MS);
    const candidates = await this.prisma.candidateProfile.findMany({
      where: {
        ...candidateVisibilityFilter,
        openToStaffing: true,
        availabilityStatus: { not: AvailabilityStatus.NOT_LOOKING },
        availabilityConfirmedAt: { lte: dueBefore },
      },
      select: { id: true, userId: true, availabilityConfirmedAt: true, availabilityReminderSentAt: true },
      take: BATCH,
    });

    let sent = 0;
    for (const c of candidates) {
      if (!reminderDue(c.availabilityConfirmedAt, c.availabilityReminderSentAt, now)) continue;
      try {
        await this.notifications.sendEmail(
          c.userId,
          NotificationType.STAFFING_AVAILABILITY_REMINDER,
          'Still available? Confirm in one tap',
          renderNotificationEmail(
            `<p>You're open to recruiters on MyAmbii. To keep showing up in their searches, please confirm your availability is still accurate.</p>` +
              `<p>If nothing has changed, it takes one tap. If you're not looking any more, you can turn it off there too.</p>`,
            { label: 'Confirm availability', url: `${WEB_BASE_URL}/profile#staffing` },
          ),
        );
        await this.prisma.candidateProfile.update({ where: { id: c.id }, data: { availabilityReminderSentAt: now } });
        sent++;
      } catch (err) {
        this.logger.error(`Availability reminder failed for profile ${c.id}: ${(err as Error).message}`);
      }
    }
    if (sent) this.logger.log(`Sent ${sent} recruiter availability reminder(s)`);
    return sent;
  }
}
