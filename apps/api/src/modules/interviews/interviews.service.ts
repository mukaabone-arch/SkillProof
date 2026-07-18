import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertTransition } from '../shortlist/pipeline-transitions';
import { RespondInviteDto, RespondOfferDto } from './interviews.dto';

/**
 * Candidate-facing view — deliberately narrower than
 * ShortlistService.shortlistEntryInclude (the employer's own view of the
 * same rows): only the latest round (see InterviewsService.present, "NOT a
 * total count" per the spec) and no `note` field on either the round or the
 * entry itself, since both are employer-only.
 */
const mineInclude = {
  organization: { select: { name: true } },
  job: { select: { id: true, title: true } },
  rounds: { orderBy: { roundNumber: 'desc' as const }, take: 1 },
} satisfies Prisma.ShortlistEntryInclude;

type MineEntry = Prisma.ShortlistEntryGetPayload<{ include: typeof mineInclude }>;

@Injectable()
export class InterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listMine(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) return [];

    const entries = await this.prisma.shortlistEntry.findMany({
      where: { candidateId: profile.id },
      orderBy: { updatedAt: 'desc' },
      include: mineInclude,
    });

    return entries.map((e) => this.present(e));
  }

  async respondInvite(userId: string, id: string, dto: RespondInviteDto) {
    const { entry, profile } = await this.getOwnedEntry(userId, id);
    const action = dto.response === 'ACCEPT' ? 'acceptInvite' : 'declineInvite';
    const nextStage = assertTransition(entry.stage, action);

    await this.prisma.shortlistEntry.update({ where: { id }, data: { stage: nextStage } });

    const roleLine = entry.job ? ` for ${entry.job.title}` : '';
    const verb = dto.response === 'ACCEPT' ? 'accepted' : 'declined';
    await this.notify(
      entry.addedByUserId,
      NotificationType.PIPELINE_INVITE_RESPONSE,
      `${candidateLabel(profile.fullName)} ${verb} your interview invite${roleLine}`,
      `<p><strong>${escapeHtml(candidateLabel(profile.fullName))}</strong> has ${verb} your interview invite${roleLine}.</p>`,
    );

    return { id, stage: nextStage };
  }

  /**
   * Settable only while stage is OFFER — see ShortlistEntry.candidateResponse's
   * doc comment. Once the employer's outcome write moves stage past OFFER,
   * this is 409, not a silent no-op: the decision window is closed.
   */
  async respondOffer(userId: string, id: string, dto: RespondOfferDto) {
    const { entry, profile } = await this.getOwnedEntry(userId, id);
    if (entry.stage !== ShortlistStage.OFFER) {
      throw new ConflictException(
        `Cannot respond to an offer — entry is in ${entry.stage}, expected OFFER.`,
      );
    }

    await this.prisma.shortlistEntry.update({ where: { id }, data: { candidateResponse: dto.response } });

    const roleLine = entry.job ? ` for ${entry.job.title}` : '';
    await this.notify(
      entry.addedByUserId,
      NotificationType.PIPELINE_OFFER_RESPONSE,
      `${candidateLabel(profile.fullName)} responded to your offer${roleLine}: ${dto.response}`,
      `<p><strong>${escapeHtml(candidateLabel(profile.fullName))}</strong> responded to your offer${roleLine}: <strong>${dto.response}</strong>.</p>`,
    );

    return { id, candidateResponse: dto.response };
  }

  private present(entry: MineEntry) {
    const currentRound = entry.rounds[0];
    return {
      id: entry.id,
      orgName: entry.organization.name,
      job: entry.job,
      stage: entry.stage,
      inviteMessage: entry.inviteMessage,
      currentRound: currentRound
        ? {
            roundNumber: currentRound.roundNumber,
            status: currentRound.status,
            channel: currentRound.channel,
            scheduledAt: currentRound.scheduledAt,
          }
        : null,
      candidateResponse: entry.candidateResponse,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  /** Never throws — same "notifications are best-effort" contract as every other caller of NotificationsService. */
  private async notify(userId: string, type: NotificationType, subject: string, html: string) {
    try {
      await this.notifications.sendEmail(userId, type, subject, html);
    } catch {
      // NotificationsService already swallows its own errors; this catch is defense in depth.
    }
  }

  /** IDOR protection: a candidate may only act on their own shortlist entries. Not-found vs. not-yours mirrors ShortlistService.getOwnedEntry (404 vs 403). */
  private async getOwnedEntry(userId: string, id: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Interview not found');

    const entry = await this.prisma.shortlistEntry.findUnique({ where: { id }, include: mineInclude });
    if (!entry) throw new NotFoundException('Interview not found');
    if (entry.candidateId !== profile.id) throw new ForbiddenException();

    return { entry, profile };
  }
}

function candidateLabel(fullName: string | null): string {
  return fullName ?? 'A candidate';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
