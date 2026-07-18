import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertTransition } from './pipeline-transitions';
import { AddRoundDto, InviteDto, OutcomeDto, RejectDto, UpdateRoundDto } from './shortlist-pipeline.dto';

/** Just enough to write a notification and check ownership — not the full candidate-summary shape ShortlistService.present() builds. */
const entryContext = {
  organization: { select: { name: true } },
  job: { select: { title: true } },
  candidateProfile: { select: { userId: true } },
} as const;

@Injectable()
export class ShortlistPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async invite(orgId: string, id: string, dto: InviteDto) {
    const entry = await this.getOwnedEntry(orgId, id);
    const nextStage = assertTransition(entry.stage, 'invite');

    await this.prisma.shortlistEntry.update({
      where: { id },
      data: { stage: nextStage, inviteMessage: dto.message },
    });

    const roleLine = entry.job ? ` for ${entry.job.title}` : '';
    await this.notify(
      entry.candidateProfile.userId,
      NotificationType.PIPELINE_INVITE,
      `${entry.organization.name} invited you to interview${roleLine}`,
      `<p><strong>${entry.organization.name}</strong> has invited you to interview${roleLine}.</p>` +
        (dto.message ? `<p>${escapeHtml(dto.message)}</p>` : '') +
        `<p>Open your Interviews page to accept or decline.</p>`,
    );

    return { id };
  }

  /**
   * Rounds only exist — and are only mutable — while the entry is actually
   * in the interviewing phase. Adding/editing a round before the candidate
   * has accepted the invite, or after the employer has moved on to an
   * offer/rejection, would leave stale "next steps" the candidate might act
   * on; 409 instead.
   */
  async addRound(orgId: string, id: string, dto: AddRoundDto) {
    const entry = await this.getOwnedEntry(orgId, id);
    this.assertInterviewing(entry.stage, 'add a round');

    const last = await this.prisma.interviewRound.findFirst({
      where: { shortlistEntryId: id },
      orderBy: { roundNumber: 'desc' },
    });
    const round = await this.prisma.interviewRound.create({
      data: {
        shortlistEntryId: id,
        roundNumber: (last?.roundNumber ?? 0) + 1,
        channel: dto.channel,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        note: dto.note,
      },
    });

    const roleLine = entry.job ? ` for ${entry.job.title}` : '';
    await this.notify(
      entry.candidateProfile.userId,
      NotificationType.PIPELINE_ROUND_SCHEDULED,
      `Next interview round scheduled at ${entry.organization.name}`,
      `<p><strong>${entry.organization.name}</strong> has scheduled round ${round.roundNumber}${roleLine}.</p>` +
        (dto.channel ? `<p>${escapeHtml(dto.channel)}</p>` : '') +
        `<p>Open your Interviews page for details.</p>`,
    );

    return round;
  }

  async updateRound(orgId: string, id: string, roundId: string, dto: UpdateRoundDto) {
    const entry = await this.getOwnedEntry(orgId, id);
    this.assertInterviewing(entry.stage, 'update a round');

    const round = await this.prisma.interviewRound.findUnique({ where: { id: roundId } });
    if (!round || round.shortlistEntryId !== id) throw new NotFoundException('Interview round not found');

    return this.prisma.interviewRound.update({
      where: { id: roundId },
      data: {
        status: dto.status,
        channel: dto.channel,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
        note: dto.note,
      },
    });
  }

  async offer(orgId: string, id: string) {
    const entry = await this.getOwnedEntry(orgId, id);
    const nextStage = assertTransition(entry.stage, 'extendOffer');

    await this.prisma.shortlistEntry.update({ where: { id }, data: { stage: nextStage } });

    const roleLine = entry.job ? ` for ${entry.job.title}` : '';
    await this.notify(
      entry.candidateProfile.userId,
      NotificationType.PIPELINE_OFFER,
      `${entry.organization.name} extended you an offer`,
      `<p><strong>${entry.organization.name}</strong> has extended you an offer${roleLine}.</p>` +
        `<p>Open your Interviews page to respond.</p>`,
    );

    return { id };
  }

  /** HIRED/CLOSED is the employer's own final call — see ShortlistEntry.candidateResponse's doc comment on why this never touches that field. */
  async outcome(orgId: string, id: string, dto: OutcomeDto) {
    const entry = await this.getOwnedEntry(orgId, id);
    const action = dto.outcome === ShortlistStage.HIRED ? 'markHired' : 'markClosed';
    const nextStage = assertTransition(entry.stage, action);

    await this.prisma.shortlistEntry.update({ where: { id }, data: { stage: nextStage } });
    return { id };
  }

  async reject(orgId: string, id: string, dto: RejectDto) {
    const entry = await this.getOwnedEntry(orgId, id);
    const nextStage = assertTransition(entry.stage, 'reject');

    await this.prisma.shortlistEntry.update({
      where: { id },
      data: { stage: nextStage, rejectReason: dto.reason },
    });

    const roleLine = entry.job ? ` for ${entry.job.title}` : '';
    await this.notify(
      entry.candidateProfile.userId,
      NotificationType.PIPELINE_REJECTED,
      `Update on your application${roleLine} at ${entry.organization.name}`,
      `<p><strong>${entry.organization.name}</strong> has decided not to move forward with you${roleLine} at this time.</p>` +
        `<p>Thank you for your interest — we encourage you to keep building your verified skills for future opportunities.</p>`,
    );

    return { id };
  }

  private assertInterviewing(stage: ShortlistStage, action: string) {
    if (stage !== ShortlistStage.INTERVIEWING) {
      throw new ConflictException(`Cannot ${action} — entry is in ${stage}, expected INTERVIEWING.`);
    }
  }

  /** Never throws — same "notifications are best-effort" contract as every other caller of NotificationsService. */
  private async notify(userId: string, type: NotificationType, subject: string, html: string) {
    try {
      await this.notifications.sendEmail(userId, type, subject, html);
    } catch {
      // NotificationsService already swallows its own errors; this catch is defense in depth.
    }
  }

  /** IDOR protection: employers may only touch shortlist entries in their own org. Same pattern as ShortlistService.getOwnedEntry. */
  private async getOwnedEntry(orgId: string, id: string) {
    const entry = await this.prisma.shortlistEntry.findUnique({ where: { id }, include: entryContext });
    if (!entry) throw new NotFoundException('Shortlist entry not found');
    if (entry.orgId !== orgId) throw new ForbiddenException();
    return entry;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
