import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType, OutreachCampaignStatus, OutreachEventType, OutreachStatus, RecruiterContactPreference } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { outreachEmail } from './outreach.service';
import { nextFollowUpAt } from './outreach.util';

const BATCH = 200;

/**
 * Sends the reminders for outreach messages nobody has answered yet
 * (OutreachCampaign.followUpDays after the first message, at most two).
 * Any reply, the candidate turning contact off, or the campaign pausing
 * or closing stops them. Email only — the app has no push sending yet.
 */
@Injectable()
export class OutreachFollowUpJob {
  private readonly logger = new Logger(OutreachFollowUpJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('15 * * * *')
  async run(now = new Date()): Promise<number> {
    const due = await this.prisma.outreachMessage.findMany({
      where: {
        status: OutreachStatus.SENT,
        nextFollowUpAt: { lte: now },
        campaign: { status: OutreachCampaignStatus.ACTIVE },
      },
      take: BATCH,
      orderBy: { nextFollowUpAt: 'asc' },
      include: {
        campaign: { select: { followUpDays: true, organization: { select: { name: true } }, job: { select: { title: true, status: true } } } },
        candidateProfile: { select: { userId: true, recruiterContact: true, deletedAt: true, deactivatedAt: true } },
      },
    });

    let sent = 0;
    for (const m of due) {
      const p = m.candidateProfile;
      const stop =
        p.recruiterContact === RecruiterContactPreference.OFF || !!p.deletedAt || !!p.deactivatedAt || m.campaign.job.status !== 'LIVE';
      // Conditional on followUpsSent, so an overlapping run never sends the same reminder twice.
      const claimed = await this.prisma.outreachMessage.updateMany({
        where: { id: m.id, status: OutreachStatus.SENT, followUpsSent: m.followUpsSent },
        data: stop
          ? { nextFollowUpAt: null }
          : {
              followUpsSent: m.followUpsSent + 1,
              nextFollowUpAt: nextFollowUpAt(m.sentAt ?? now, m.campaign.followUpDays, m.followUpsSent + 1),
            },
      });
      if (claimed.count === 0 || stop) continue;

      await this.prisma.outreachEvent.create({ data: { messageId: m.id, type: OutreachEventType.FOLLOW_UP, detail: `Reminder ${m.followUpsSent + 1}` } });
      await this.notifications.sendEmail(
        p.userId,
        NotificationType.OUTREACH_FOLLOW_UP,
        `Reminder: ${m.campaign.organization.name} would like to hear from you`,
        outreachEmail({
          userId: p.userId,
          messageId: m.id,
          orgName: m.campaign.organization.name,
          jobTitle: m.campaign.job.title,
          body: m.body,
          followUp: true,
        }),
      );
      sent++;
    }
    if (sent > 0) this.logger.log(`Sent ${sent} outreach follow-ups`);
    return sent;
  }
}
