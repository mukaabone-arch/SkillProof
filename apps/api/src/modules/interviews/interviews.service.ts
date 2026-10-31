import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InterviewQuestionCategory, NotificationType, Prisma, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { assertTransition } from '../shortlist/pipeline-transitions';
import { RespondInviteDto, RespondOfferDto } from './interviews.dto';
import { PREP_CHECKLIST_KEYS, buildSkillPlan, formatPlace, jsonStrings, stablePick } from './interview-prep';

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

  /**
   * The per-interview prep plan (web: InterviewPrepPlan). Built only from
   * data the candidate already owns or is shown elsewhere — the job's skills
   * and description, their own live badges and discussion-format coaching
   * notes, and the admin-curated behavioral question bank. Nothing is
   * generated here.
   */
  async getPrep(userId: string, id: string) {
    const { entry, profile } = await this.getOwnedEntry(userId, id);

    const job = entry.jobId
      ? await this.prisma.job.findUnique({
          where: { id: entry.jobId },
          include: { skills: { include: { skill: { select: { name: true } } } } },
        })
      : null;
    const jobSkills = (job?.skills ?? []).map((s) => ({
      skillId: s.skillId,
      skillName: s.skill.name,
      requiredLevel: s.requiredLevel,
      isRequired: s.isRequired,
    }));
    const skillIds = jobSkills.map((s) => s.skillId);

    const badges = skillIds.length
      ? await this.prisma.badge.findMany({
          where: { userId, skillId: { in: skillIds }, revokedAt: null, expiresAt: { gt: new Date() } },
          select: { skillId: true, level: true, sessionId: true },
        })
      : [];

    const sessionIds = badges.map((b) => b.sessionId).filter((s): s is string => !!s);
    const feedback = sessionIds.length
      ? await this.prisma.liveClaimFeedback.findMany({
          where: { sessionId: { in: sessionIds } },
          orderBy: { createdAt: 'asc' },
          select: { sessionId: true, strengths: true, gaps: true },
        })
      : [];
    const coaching = new Map<string, { strengths: string[]; gaps: string[] }>();
    for (const f of feedback) {
      const c = coaching.get(f.sessionId) ?? { strengths: [], gaps: [] };
      c.strengths = [...c.strengths, ...jsonStrings(f.strengths, 2)].slice(0, 2);
      c.gaps = [...c.gaps, ...jsonStrings(f.gaps, 1)].slice(0, 1);
      coaching.set(f.sessionId, c);
    }

    const checks = skillIds.length
      ? await this.prisma.assessment.findMany({ where: { skillId: { in: skillIds } }, select: { skillId: true } })
      : [];
    const { proven, toProbe } = buildSkillPlan(jobSkills, badges, coaching, new Set(checks.map((c) => c.skillId)));

    const bank = await this.prisma.interviewQuestion.findMany({
      where: {
        active: true,
        category: {
          in: [
            InterviewQuestionCategory.PROBLEM_SOLVING,
            InterviewQuestionCategory.TEAMWORK,
            InterviewQuestionCategory.COMMUNICATION,
            InterviewQuestionCategory.MOTIVATION,
          ],
        },
      },
      select: { id: true, text: true, whatToLookFor: true, followUpProbes: true },
    });
    const questions = stablePick(bank, entry.id, 3).map((q) => ({
      id: q.id,
      text: q.text,
      whatToLookFor: q.whatToLookFor,
      followUp: q.followUpProbes[0] ?? null,
    }));

    const progress = await this.prisma.interviewPrepProgress.findUnique({ where: { shortlistEntryId: entry.id } });
    const allowed = PREP_CHECKLIST_KEYS as readonly string[];

    return {
      id: entry.id,
      orgName: entry.organization.name,
      jobTitle: entry.job?.title ?? null,
      stage: entry.stage,
      job: job
        ? {
            location: formatPlace(job),
            remote: job.remote,
            experienceMin: job.experienceMin,
            experienceMax: job.experienceMax,
            descriptionExcerpt: excerpt(job.description, 220),
          }
        : null,
      candidate: { yearsOfExp: profile.yearsOfExp, location: formatPlace(profile) },
      proven,
      toProbe,
      questions,
      checklist: (progress?.done ?? []).filter((k) => allowed.includes(k)),
    };
  }

  async updatePrepChecklist(userId: string, id: string, done: string[]) {
    await this.getOwnedEntry(userId, id);
    const allowed = PREP_CHECKLIST_KEYS as readonly string[];
    const clean = [...new Set(done)].filter((k) => allowed.includes(k));
    await this.prisma.interviewPrepProgress.upsert({
      where: { shortlistEntryId: id },
      create: { shortlistEntryId: id, done: clean },
      update: { done: clean },
    });
    return { checklist: clean };
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

/** First sentence-ish of the job description, cut at a word boundary. */
function excerpt(text: string | null | undefined, max: number): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max) + '…';
}

function candidateLabel(fullName: string | null): string {
  return fullName ?? 'A candidate';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
