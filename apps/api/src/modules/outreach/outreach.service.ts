import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CertVerificationStatus,
  ClaimStatus,
  JobStatus,
  NotificationType,
  OrgType,
  OutreachCampaignStatus,
  OutreachEventType,
  OutreachStatus,
  Prisma,
  RecruiterContactPreference,
  SkillLevel,
  StaffingRequestStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { PLANS } from '../../config/plans.config';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderNotificationEmail } from '../notifications/notification-email.template';
import { candidateVisibilityFilter } from '../account/account.util';
import { formatLocation } from '../locations/location-format.util';
import { candidateRef } from '../staffing/staffing.util';
import { CandidateSkillClaim, JobSkillRequirement, compareByMatchRank, scoreCandidate } from '../jobs/scoring';
import {
  DAY_MS,
  DECLINED_COOLDOWN_DAYS,
  DELIVERED_STATUSES,
  DRAFTS_PER_RUN,
  RECRUITER_DAILY_LIMIT,
  contactAllowed,
  escapeHtml,
  fallbackMessage,
  matchReason,
  messageToHtml,
  nextFollowUpAt,
  personalise,
  unsubscribeToken,
} from './outreach.util';
import { UpdateOutreachMessageDto } from './outreach.dto';

const jobInclude = { skills: { include: { skill: true } }, organization: { select: { id: true, name: true, type: true } } } satisfies Prisma.JobInclude;
type JobWithSkills = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

export interface RankedCandidate {
  profileId: string;
  fullName: string | null;
  yearsOfExp: number | null;
  score: number;
  matched: { skillName: string; level: SkillLevel }[];
  missing: string[];
  matchReason: string;
}

export interface SendResult {
  sent: number;
  heldDailyLimit: number;
  heldWeeklyLimit: number;
  skipped: number;
}

/**
 * AI sourcing, the org side: rank the whole pool of candidates who allow
 * contact against one job, draft a personal message for each, let the
 * recruiter edit and approve, then send and track. A person approves every
 * first message — nothing here sends without an explicit send() call.
 *
 * Who can be reached: visible candidates with >=1 verified claim (the same
 * privacy gate as search and matching) whose recruiterContact allows this
 * match (see contactAllowed). A recruiter (STAFFING) org also needs the
 * candidate's existing agency opt-in (openToStaffing), respects staffing
 * blocks, and sees the candidate anonymised until they say Interested —
 * the same rule as StaffingService's search and availability requests.
 */
@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
  ) {}

  async listCampaigns(orgId: string) {
    const campaigns = await this.prisma.outreachCampaign.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      include: { job: { select: { id: true, title: true, status: true } } },
    });
    const counts = await this.prisma.outreachMessage.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: campaigns.map((c) => c.id) } },
      _count: { _all: true },
    });
    return campaigns.map((c) => ({
      id: c.id,
      status: c.status,
      createdAt: c.createdAt,
      job: c.job,
      counts: countsFor(counts.filter((r) => r.campaignId === c.id)),
    }));
  }

  /** One open campaign per job: asking again for the same job returns the one that exists. */
  async createCampaign(orgId: string, userId: string, jobId: string) {
    const job = await this.getOwnedJob(orgId, jobId);
    if (job.status !== JobStatus.LIVE) throw new BadRequestException('Publish this job before reaching out — candidates open it from your message.');
    if (job.skills.length === 0) throw new BadRequestException('Add the skills this job needs first — AI sourcing matches candidates on verified skills.');

    const open = await this.prisma.outreachCampaign.findFirst({
      where: { orgId, jobId, status: { not: OutreachCampaignStatus.CLOSED } },
      select: { id: true },
    });
    if (open) return this.getCampaign(orgId, userId, open.id);

    const campaign = await this.prisma.outreachCampaign.create({ data: { orgId, jobId, createdByUserId: userId } });
    await this.draftMore(job, campaign.id, userId);
    return this.getCampaign(orgId, userId, campaign.id);
  }

  /** "Find more": drafts the next best candidates not yet in any campaign for this job. */
  async findMore(orgId: string, userId: string, campaignId: string) {
    const campaign = await this.getOwnedCampaign(orgId, campaignId);
    if (campaign.status === OutreachCampaignStatus.CLOSED) throw new ConflictException('This campaign is closed.');
    const job = await this.getOwnedJob(orgId, campaign.jobId);
    const added = await this.draftMore(job, campaign.id, userId);
    return { added, campaign: await this.getCampaign(orgId, userId, campaign.id) };
  }

  async getCampaign(orgId: string, userId: string, campaignId: string) {
    const campaign = await this.prisma.outreachCampaign.findFirst({
      where: { id: campaignId, orgId },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            status: true,
            postedForClient: { select: { id: true, name: true } },
            projectRole: { select: { id: true } },
          },
        },
        organization: { select: { type: true } },
        messages: {
          orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
          include: {
            candidateProfile: {
              select: {
                id: true,
                fullName: true,
                headline: true,
                roleTitle: true,
                roleTitleOther: true,
                yearsOfExp: true,
                locationCity: true,
                locationRegion: true,
                locationCountry: true,
                locationLegacy: true,
                user: { select: { email: true, phone: true } },
              },
            },
          },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const staffing = campaign.organization.type === OrgType.STAFFING;
    const sentToday = await this.sentByUserSince(userId, new Date(Date.now() - DAY_MS));

    return {
      id: campaign.id,
      status: campaign.status,
      createdAt: campaign.createdAt,
      followUpDays: campaign.followUpDays,
      job: {
        id: campaign.job.id,
        title: campaign.job.title,
        status: campaign.job.status,
        client: campaign.job.postedForClient,
        projectRoleId: campaign.job.projectRole?.id ?? null,
      },
      anonymised: staffing,
      limits: { dailyLimit: RECRUITER_DAILY_LIMIT, sentToday, remainingToday: Math.max(0, RECRUITER_DAILY_LIMIT - sentToday) },
      counts: countsFor(
        Object.entries(
          campaign.messages.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {}),
        ).map(([status, n]) => ({ status: status as OutreachStatus, _count: { _all: n } })),
      ),
      messages: campaign.messages.map((m) => {
        const p = m.candidateProfile;
        const interested = m.status === OutreachStatus.INTERESTED;
        // Recruiters see a candidate anonymised until they say Interested (StaffingService's rule).
        const showName = !staffing || interested;
        return {
          id: m.id,
          candidateId: p.id,
          candidate: {
            ref: candidateRef(p.id),
            name: showName ? p.fullName : null,
            headline: showName ? p.headline : null,
            roleTitle: p.roleTitle,
            roleTitleOther: p.roleTitleOther,
            yearsOfExp: p.yearsOfExp,
            location: [p.locationCity, p.locationRegion, p.locationCountry].filter(Boolean).join(', ') || (showName ? formatLocation(p) : null),
          },
          // Contact details only once the candidate has said Interested.
          contact: interested ? { email: p.user.email, phone: p.user.phone } : null,
          score: m.score,
          matchReason: m.matchReason,
          body: m.body,
          status: m.status,
          sentAt: m.sentAt,
          followUpsSent: m.followUpsSent,
          nextFollowUpAt: m.nextFollowUpAt,
          respondedAt: m.respondedAt,
          candidateNote: m.candidateNote,
          shortlistEntryId: m.shortlistEntryId,
        };
      }),
    };
  }

  async updateMessage(orgId: string, userId: string, campaignId: string, messageId: string, dto: UpdateOutreachMessageDto) {
    await this.getOwnedCampaign(orgId, campaignId);
    const m = await this.prisma.outreachMessage.findFirst({ where: { id: messageId, campaignId } });
    if (!m) throw new NotFoundException('Message not found');
    if (m.status !== OutreachStatus.DRAFT && m.status !== OutreachStatus.SKIPPED) {
      throw new ConflictException('This message has already been sent.');
    }
    const data: Prisma.OutreachMessageUpdateInput = {};
    if (dto.body !== undefined) data.body = dto.body.trim();
    if (dto.skip !== undefined) data.status = dto.skip ? OutreachStatus.SKIPPED : OutreachStatus.DRAFT;
    const updated = await this.prisma.outreachMessage.update({ where: { id: m.id }, data });
    if (dto.body !== undefined && dto.body.trim() !== m.body) {
      await this.prisma.outreachEvent.create({ data: { messageId: m.id, type: OutreachEventType.EDITED, actorUserId: userId } });
    }
    return { id: updated.id, body: updated.body, status: updated.status };
  }

  /**
   * Sends approved drafts. Limits are checked here, at send time, not when
   * drafting: RECRUITER_DAILY_LIMIT per sender per rolling 24h, and each
   * candidate's own weekly limit across all orgs. A draft held by a limit
   * stays a DRAFT, so sending again later picks it up. A candidate who
   * turned contact off (or was hidden) since drafting is skipped.
   */
  async send(orgId: string, userId: string, campaignId: string, messageIds?: string[]): Promise<SendResult> {
    const campaign = await this.getOwnedCampaign(orgId, campaignId);
    if (campaign.status !== OutreachCampaignStatus.ACTIVE) throw new ConflictException('Resume this campaign before sending.');
    const job = await this.getOwnedJob(orgId, campaign.jobId);
    if (job.status !== JobStatus.LIVE) throw new BadRequestException('This job is no longer live, so messages about it can’t be sent.');
    const staffing = job.organization.type === OrgType.STAFFING;

    const drafts = await this.prisma.outreachMessage.findMany({
      where: { campaignId, status: OutreachStatus.DRAFT, ...(messageIds?.length ? { id: { in: messageIds } } : {}) },
      orderBy: { score: 'desc' },
      include: {
        candidateProfile: {
          select: {
            id: true,
            userId: true,
            fullName: true,
            recruiterContact: true,
            outreachWeeklyLimit: true,
            openToStaffing: true,
            deletedAt: true,
            deactivatedAt: true,
            isInternalTestAccount: true,
          },
        },
      },
    });

    const now = new Date();
    let budget = RECRUITER_DAILY_LIMIT - (await this.sentByUserSince(userId, new Date(now.getTime() - DAY_MS)));
    const result: SendResult = { sent: 0, heldDailyLimit: 0, heldWeeklyLimit: 0, skipped: 0 };
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

    for (const d of drafts) {
      const p = d.candidateProfile;
      const reachable =
        !p.deletedAt &&
        !p.deactivatedAt &&
        !p.isInternalTestAccount &&
        contactAllowed(p.recruiterContact, d.score) &&
        (!staffing || p.openToStaffing);
      if (!reachable) {
        await this.prisma.outreachMessage.update({ where: { id: d.id }, data: { status: OutreachStatus.SKIPPED } });
        await this.prisma.outreachEvent.create({
          data: { messageId: d.id, type: OutreachEventType.STOPPED, detail: 'Candidate no longer accepts messages' },
        });
        result.skipped++;
        continue;
      }
      if (budget <= 0) {
        result.heldDailyLimit++;
        continue;
      }
      const receivedThisWeek = await this.prisma.outreachMessage.count({
        where: { candidateId: p.id, status: { in: DELIVERED_STATUSES }, sentAt: { gte: weekAgo } },
      });
      if (receivedThisWeek >= p.outreachWeeklyLimit) {
        result.heldWeeklyLimit++;
        continue;
      }

      // Conditional on still being a DRAFT, so two clicks (or two tabs) never send twice.
      const claimed = await this.prisma.outreachMessage.updateMany({
        where: { id: d.id, status: OutreachStatus.DRAFT },
        data: {
          status: OutreachStatus.SENT,
          sentAt: now,
          sentByUserId: userId,
          nextFollowUpAt: nextFollowUpAt(now, campaign.followUpDays, 0),
        },
      });
      if (claimed.count === 0) continue;
      await this.prisma.outreachEvent.create({ data: { messageId: d.id, type: OutreachEventType.SENT, actorUserId: userId } });
      budget--;
      result.sent++;

      await this.notifications.sendEmail(
        p.userId,
        NotificationType.OUTREACH_MESSAGE,
        `${job.organization.name} would like to talk to you about a ${job.title} role`,
        outreachEmail({ userId: p.userId, messageId: d.id, orgName: job.organization.name, jobTitle: job.title, body: d.body }),
      );
    }
    return result;
  }

  /**
   * PAUSED stops sending and follow-ups but keeps every message open for a
   * reply. CLOSED is final: messages still waiting for an answer become
   * STOPPED (the candidate's inbox shows the role is no longer open to
   * replies) and their follow-ups are cancelled.
   */
  async setStatus(orgId: string, userId: string, campaignId: string, status: OutreachCampaignStatus) {
    const campaign = await this.getOwnedCampaign(orgId, campaignId);
    if (campaign.status === OutreachCampaignStatus.CLOSED) throw new ConflictException('This campaign is closed.');
    await this.prisma.outreachCampaign.update({ where: { id: campaign.id }, data: { status } });
    if (status === OutreachCampaignStatus.CLOSED) {
      const live = await this.prisma.outreachMessage.findMany({
        where: { campaignId, status: { in: [OutreachStatus.SENT, OutreachStatus.NOT_NOW] } },
        select: { id: true },
      });
      await this.prisma.outreachMessage.updateMany({
        where: { id: { in: live.map((m) => m.id) } },
        data: { status: OutreachStatus.STOPPED, nextFollowUpAt: null },
      });
      await this.prisma.outreachMessage.updateMany({
        where: { campaignId, status: OutreachStatus.DRAFT },
        data: { status: OutreachStatus.SKIPPED },
      });
      if (live.length > 0) {
        await this.prisma.outreachEvent.createMany({
          data: live.map((m) => ({ messageId: m.id, type: OutreachEventType.STOPPED, actorUserId: userId, detail: 'Campaign closed' })),
        });
      }
    }
    return this.getCampaign(orgId, userId, campaign.id);
  }

  /**
   * Ranks every reachable candidate for this job with the same scorer as
   * MatchingService (verified claims and certifications only), minus anyone
   * already contacted for this job, already applying or shortlisted for
   * it, or who told this org "Not for me" in the last 90 days.
   */
  async rankCandidates(job: JobWithSkills, limit = DRAFTS_PER_RUN): Promise<RankedCandidate[]> {
    const orgId = job.orgId;
    const staffing = job.organization.type === OrgType.STAFFING;
    const jobSkills: JobSkillRequirement[] = job.skills.map((js) => ({
      skillId: js.skillId,
      skillName: js.skill.name,
      requiredLevel: js.requiredLevel,
      isRequired: js.isRequired,
    }));
    const jobSkillIds = jobSkills.map((s) => s.skillId);
    const cooldown = new Date(Date.now() - DECLINED_COOLDOWN_DAYS * DAY_MS);

    const [contacted, applied, shortlisted, declined] = await Promise.all([
      this.prisma.outreachMessage.findMany({ where: { campaign: { jobId: job.id } }, select: { candidateId: true } }),
      this.prisma.application.findMany({ where: { jobId: job.id }, select: { candidateProfileId: true } }),
      this.prisma.shortlistEntry.findMany({ where: { jobId: job.id }, select: { candidateId: true } }),
      this.prisma.outreachMessage.findMany({
        where: { orgId, status: OutreachStatus.NOT_INTERESTED, respondedAt: { gte: cooldown } },
        select: { candidateId: true },
      }),
    ]);
    const excluded = [
      ...new Set([
        ...contacted.map((r) => r.candidateId),
        ...applied.map((r) => r.candidateProfileId),
        ...shortlisted.map((r) => r.candidateId),
        ...declined.map((r) => r.candidateId),
      ]),
    ];

    const conditions: Prisma.CandidateProfileWhereInput[] = [
      candidateVisibilityFilter,
      { recruiterContact: { not: RecruiterContactPreference.OFF } },
      { skillClaims: { some: { status: ClaimStatus.VERIFIED } } },
      { skillClaims: { some: { skillId: { in: jobSkillIds } } } },
    ];
    if (excluded.length > 0) conditions.push({ id: { notIn: excluded } });
    if (staffing) {
      conditions.push({ openToStaffing: true }, { staffingBlocks: { none: { orgId } } });
      // Someone who told this agency "Not right now" on an availability request in the cooldown stays out too.
      conditions.push({
        staffingRequests: { none: { orgId, status: StaffingRequestStatus.NOT_NOW, respondedAt: { gte: cooldown } } },
      });
    }

    const profiles = await this.prisma.candidateProfile.findMany({
      where: { AND: conditions },
      select: {
        id: true,
        fullName: true,
        yearsOfExp: true,
        recruiterContact: true,
        skillClaims: { where: { skillId: { in: jobSkillIds } }, select: { skillId: true, level: true, status: true } },
        certifications: {
          where: {
            verificationStatus: CertVerificationStatus.VERIFIED,
            skillTags: { hasSome: jobSkillIds },
            OR: [{ expiryDate: null }, { expiryDate: { gt: new Date() } }],
          },
          select: { skillTags: true },
        },
      },
    });

    const scored = profiles
      .map((p) => {
        const claims = new Map<string, CandidateSkillClaim>(
          p.skillClaims.map((c) => [c.skillId, { skillId: c.skillId, level: c.level, verified: c.status === ClaimStatus.VERIFIED }]),
        );
        const certified = new Set(p.certifications.flatMap((c) => c.skillTags));
        const r = scoreCandidate(jobSkills, claims, certified, p.yearsOfExp, job.experienceMin, job.experienceMax);
        return {
          profileId: p.id,
          fullName: p.fullName,
          yearsOfExp: p.yearsOfExp,
          pref: p.recruiterContact,
          score: r.score,
          matched: r.matched.filter((m) => m.candidateLevel).map((m) => ({ skillName: m.skillName, level: m.candidateLevel as SkillLevel })),
          missing: r.missing.map((m) => m.skillName),
          matchReason: matchReason(r.matched, r.missing),
        };
      })
      .filter((c) => contactAllowed(c.pref, c.score));

    const tiers = await this.entitlements.resolveEffectiveTiersForCandidates(scored.map((c) => c.profileId));
    return scored
      .map((c) => ({ ...c, tierBoost: PLANS[tiers.get(c.profileId)!]?.searchRankBoost ?? 0 }))
      .sort(compareByMatchRank)
      .slice(0, limit)
      .map(({ tierBoost: _t, pref: _p, ...rest }) => rest);
  }

  /** Ranks, drafts messages (AI, with a template fallback) and stores them. Returns how many were added. */
  private async draftMore(job: JobWithSkills, campaignId: string, userId: string): Promise<number> {
    const ranked = await this.rankCandidates(job);
    if (ranked.length === 0) return 0;

    const location = formatLocation(job);
    const salary =
      !job.salaryNotDisclosed && job.salaryMin != null
        ? `${job.salaryCurrency} ${job.salaryMin.toLocaleString('en-IN')}${job.salaryMax ? `–${job.salaryMax.toLocaleString('en-IN')}` : '+'} per year`
        : null;

    let drafts = new Map<string, string>();
    try {
      drafts = await this.llm.draftOutreachMessages({
        jobTitle: job.title,
        orgName: job.organization.name,
        jobDescription: job.description,
        employmentType: job.employmentType,
        location,
        remote: job.remote,
        salary,
        candidates: ranked.map((c, i) => ({ key: `c${i + 1}`, matched: c.matched, missing: c.missing, yearsOfExp: c.yearsOfExp })),
      });
    } catch {
      this.logger.warn('AI outreach drafts failed; using the template for this batch');
    }

    let added = 0;
    for (const [i, c] of ranked.entries()) {
      const template =
        drafts.get(`c${i + 1}`) ??
        fallbackMessage({ jobTitle: job.title, orgName: job.organization.name, matchedSkills: c.matched, remote: job.remote, location });
      try {
        const m = await this.prisma.outreachMessage.create({
          data: {
            campaignId,
            orgId: job.orgId,
            candidateId: c.profileId,
            score: c.score,
            matchReason: c.matchReason,
            body: personalise(template, c.fullName),
          },
        });
        await this.prisma.outreachEvent.create({ data: { messageId: m.id, type: OutreachEventType.DRAFTED, actorUserId: userId } });
        added++;
      } catch (e) {
        // Unique (campaignId, candidateId): a concurrent "find more" already drafted this person.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    return added;
  }

  private sentByUserSince(userId: string, since: Date): Promise<number> {
    return this.prisma.outreachMessage.count({ where: { sentByUserId: userId, sentAt: { gte: since } } });
  }

  private async getOwnedJob(orgId: string, jobId: string): Promise<JobWithSkills> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: jobInclude });
    if (!job) throw new NotFoundException('Job not found');
    if (job.orgId !== orgId) throw new ForbiddenException();
    return job;
  }

  private async getOwnedCampaign(orgId: string, campaignId: string) {
    const campaign = await this.prisma.outreachCampaign.findFirst({ where: { id: campaignId, orgId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }
}

function countsFor(rows: { status: OutreachStatus; _count: { _all: number } }[]) {
  const n = (s: OutreachStatus) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const sent = DELIVERED_STATUSES.reduce((t, s) => t + n(s), 0);
  return {
    drafts: n(OutreachStatus.DRAFT),
    skipped: n(OutreachStatus.SKIPPED),
    sent,
    awaiting: n(OutreachStatus.SENT),
    interested: n(OutreachStatus.INTERESTED),
    notNow: n(OutreachStatus.NOT_NOW),
    notInterested: n(OutreachStatus.NOT_INTERESTED),
    stopped: n(OutreachStatus.STOPPED),
  };
}

/** The candidate's email: the recruiter's message, why they got it, and a one-click way to stop. */
export function outreachEmail(input: {
  userId: string;
  messageId: string;
  orgName: string;
  jobTitle: string;
  body: string;
  followUp?: boolean;
}): string {
  const unsubscribe = `${WEB_BASE_URL}/opportunities/unsubscribe?u=${encodeURIComponent(input.userId)}&t=${encodeURIComponent(unsubscribeToken(input.userId))}`;
  const intro = input.followUp
    ? `<p style="color:#52606d;">A reminder: ${escapeHtml(input.orgName)} is still hoping to hear from you about the ${escapeHtml(input.jobTitle)} role.</p>`
    : `<p style="color:#52606d;">${escapeHtml(input.orgName)} sent you a message about a ${escapeHtml(input.jobTitle)} role:</p>`;
  return renderNotificationEmail(
    intro +
      `<div style="border-left:3px solid #5B4FE0;padding:4px 0 4px 12px;margin:12px 0;">${messageToHtml(input.body)}</div>` +
      `<p>Reply on MyAmbii with one tap: Interested, Not now, or Not for me. Your contact details are shared only if you say Interested.</p>` +
      `<p style="color:#7b8794;font-size:12px;margin-top:24px;">Why am I getting this? Your MyAmbii settings let employers and recruiters contact you, and your verified skills match this role. ` +
      `<a href="${unsubscribe}" style="color:#7b8794;">Stop recruiter messages</a></p>`,
    { label: 'Reply on MyAmbii', url: `${WEB_BASE_URL}/opportunities?m=${encodeURIComponent(input.messageId)}` },
  );
}
