import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { NotificationType, OrgType, OutreachEventType, OutreachStatus, RecruiterContactPreference } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { NotificationsService } from '../notifications/notifications.service';
import { renderNotificationEmail } from '../notifications/notification-email.template';
import { formatLocation } from '../locations/location-format.util';
import { candidateRef } from '../staffing/staffing.util';
import { DELIVERED_STATUSES, OutreachResponse, escapeHtml, verifyUnsubscribeToken } from './outreach.util';
import { RespondOutreachDto, UpdateOutreachPreferencesDto } from './outreach.dto';

const RESPONSE_LABEL: Record<OutreachResponse, string> = {
  INTERESTED: 'is interested',
  NOT_NOW: 'said not now',
  NOT_INTERESTED: 'said this role isn’t for them',
};

/**
 * AI sourcing, the candidate side: the Opportunities inbox, one-tap
 * replies, and the "who can contact me" setting. Saying Interested is what
 * shares the candidate's contact details with that one org, and (for an
 * employer) puts them on that job's shortlist.
 */
@Injectable()
export class OutreachCandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    /** Optional so unit tests that build this service by hand need no change. */
    @Optional() private readonly webhooks?: WebhookDispatcherService,
  ) {}

  async listMine(userId: string) {
    const profile = await this.getProfile(userId);
    const messages = await this.prisma.outreachMessage.findMany({
      where: { candidateId: profile.id, status: { in: DELIVERED_STATUSES } },
      orderBy: { sentAt: 'desc' },
      take: 100,
      include: {
        campaign: {
          select: {
            organization: { select: { name: true, type: true } },
            job: {
              select: {
                id: true,
                title: true,
                status: true,
                employmentType: true,
                remote: true,
                locationCity: true,
                locationRegion: true,
                locationCountry: true,
                locationLegacy: true,
                salaryMin: true,
                salaryMax: true,
                salaryCurrency: true,
                salaryNotDisclosed: true,
              },
            },
          },
        },
      },
    });
    return messages.map((m) => {
      const job = m.campaign.job;
      return {
        id: m.id,
        orgName: m.campaign.organization.name,
        fromRecruiter: m.campaign.organization.type === OrgType.STAFFING,
        job: {
          id: job.id,
          title: job.title,
          live: job.status === 'LIVE',
          employmentType: job.employmentType,
          remote: job.remote,
          location: formatLocation(job),
          salary:
            !job.salaryNotDisclosed && job.salaryMin != null
              ? { min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency }
              : null,
        },
        body: m.body,
        status: m.status,
        sentAt: m.sentAt,
        respondedAt: m.respondedAt,
        candidateNote: m.candidateNote,
        canRespond: m.status === OutreachStatus.SENT || m.status === OutreachStatus.NOT_NOW,
      };
    });
  }

  async respond(userId: string, messageId: string, dto: RespondOutreachDto) {
    const profile = await this.getProfile(userId);
    const m = await this.prisma.outreachMessage.findFirst({
      where: { id: messageId, candidateId: profile.id },
      include: {
        campaign: { include: { organization: { select: { name: true, type: true } }, job: { select: { id: true, title: true } } } },
      },
    });
    if (!m || !DELIVERED_STATUSES.includes(m.status)) throw new NotFoundException('Message not found');
    if (m.status !== OutreachStatus.SENT && m.status !== OutreachStatus.NOT_NOW) {
      throw new ConflictException(m.status === OutreachStatus.STOPPED ? 'This role is no longer taking replies.' : 'You’ve already answered this message.');
    }

    const now = new Date();
    const status = dto.response as OutreachStatus;
    const note = dto.note?.trim() || null;
    let shortlistEntryId = m.shortlistEntryId;

    if (status === OutreachStatus.INTERESTED && m.campaign.organization.type !== OrgType.STAFFING) {
      // Employers: straight onto the job's shortlist, where the existing pipeline (invite, interviews, offer) takes over.
      const entry = await this.prisma.shortlistEntry.upsert({
        where: { orgId_candidateId_jobId: { orgId: m.orgId, candidateId: profile.id, jobId: m.campaign.jobId } },
        update: {},
        create: {
          orgId: m.orgId,
          candidateId: profile.id,
          jobId: m.campaign.jobId,
          addedByUserId: m.sentByUserId ?? m.campaign.createdByUserId,
          note: 'Said Interested to your AI sourcing message' + (note ? ` — “${note.slice(0, 300)}”` : ''),
        },
      });
      shortlistEntryId = entry.id;
    }

    await this.prisma.outreachMessage.update({
      where: { id: m.id },
      data: { status, respondedAt: now, candidateNote: note, nextFollowUpAt: null, shortlistEntryId },
    });
    await this.prisma.outreachEvent.create({
      data: { messageId: m.id, type: OutreachEventType.REPLIED, actorUserId: userId, detail: dto.response },
    });
    if (status === OutreachStatus.INTERESTED) {
      this.webhooks?.interested(m.id);
      if (shortlistEntryId && shortlistEntryId !== m.shortlistEntryId) this.webhooks?.pipelineChanged(shortlistEntryId, null);
    }

    const recipient = m.sentByUserId ?? m.campaign.createdByUserId;
    const staffing = m.campaign.organization.type === OrgType.STAFFING;
    // Recruiters see a name only once the candidate says Interested (same rule as the campaign page).
    const who = !staffing || status === OutreachStatus.INTERESTED ? profile.fullName || 'A candidate' : `Candidate ${candidateRef(profile.id)}`;
    await this.notifications.sendEmail(
      recipient,
      NotificationType.OUTREACH_REPLY,
      `${who} ${RESPONSE_LABEL[dto.response]} — ${m.campaign.job.title}`,
      renderNotificationEmail(
        `<p><strong>${escapeHtml(who)}</strong> ${RESPONSE_LABEL[dto.response]} about your ${escapeHtml(m.campaign.job.title)} role.</p>` +
          (note ? `<p>Their note: “${escapeHtml(note)}”</p>` : '') +
          (status === OutreachStatus.INTERESTED
            ? `<p>Their contact details are now on the campaign page${staffing ? '' : ', and they’re on this job’s shortlist'}.</p>`
            : ''),
        { label: 'Open the campaign', url: `${WEB_BASE_URL}/employer/outreach/${m.campaignId}` },
      ),
    );

    return { id: m.id, status, respondedAt: now, candidateNote: note };
  }

  async getPreferences(userId: string) {
    const p = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { recruiterContact: true, outreachWeeklyLimit: true, openToStaffing: true },
    });
    if (!p) throw new NotFoundException('Profile not found');
    return p;
  }

  async updatePreferences(userId: string, dto: UpdateOutreachPreferencesDto) {
    if (dto.recruiterContact === undefined && dto.outreachWeeklyLimit === undefined) {
      throw new BadRequestException('Nothing to update.');
    }
    const profile = await this.getProfile(userId);
    await this.prisma.candidateProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.recruiterContact !== undefined ? { recruiterContact: dto.recruiterContact } : {}),
        ...(dto.outreachWeeklyLimit !== undefined ? { outreachWeeklyLimit: dto.outreachWeeklyLimit } : {}),
      },
    });
    if (dto.recruiterContact === RecruiterContactPreference.OFF) await this.cancelFollowUps(profile.id);
    return this.getPreferences(userId);
  }

  /** One-click link from an outreach email; works signed out. Turns recruiter messages off. */
  async unsubscribe(userId: string, token: string) {
    if (!verifyUnsubscribeToken(userId, token)) throw new BadRequestException('This link is not valid.');
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new BadRequestException('This link is not valid.');
    await this.prisma.candidateProfile.update({ where: { id: profile.id }, data: { recruiterContact: RecruiterContactPreference.OFF } });
    await this.cancelFollowUps(profile.id);
    return { recruiterContact: RecruiterContactPreference.OFF };
  }

  /** Turning contact off cancels reminders still due; messages already received stay answerable. */
  private async cancelFollowUps(candidateId: string) {
    await this.prisma.outreachMessage.updateMany({
      where: { candidateId, status: OutreachStatus.SENT, nextFollowUpAt: { not: null } },
      data: { nextFollowUpAt: null },
    });
  }

  private async getProfile(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true, fullName: true } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }
}
