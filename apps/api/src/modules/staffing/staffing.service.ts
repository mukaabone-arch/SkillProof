import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { AvailabilityStatus, ClaimStatus, NotificationType, Prisma, SkillLevel, StaffingRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { candidateVisibilityFilter } from '../account/account.util';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { CreateStaffingRequestDto, RespondStaffingRequestDto, SearchStaffingCandidatesDto, UpdateAvailabilityDto } from './staffing.dto';
import {
  AVAILABILITY_FRESH_DAYS,
  CANDIDATE_WEEKLY_REQUEST_LIMIT,
  ORG_WEEKLY_REQUEST_LIMIT,
  REQUEST_TTL_HOURS,
  availableWithinWhere,
  candidateRef,
  effectiveStatus,
  isAvailabilityFresh,
  normaliseAvailability,
  revealsContact,
} from './staffing.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEVEL_ORDER: SkillLevel[] = [SkillLevel.L1, SkillLevel.L2, SkillLevel.L3, SkillLevel.L4];

const AVAILABILITY_SELECT = {
  openToStaffing: true,
  availabilityStatus: true,
  availableFrom: true,
  noticePeriodDays: true,
  workTypes: true,
  expectedRateMinInr: true,
  expectedRateMaxInr: true,
  expectedRateUnit: true,
  availabilityConfirmedAt: true,
} satisfies Prisma.CandidateProfileSelect;

/**
 * Staffing companies (Phase 1): candidates opt in and keep their
 * availability current; verified STAFFING orgs search that opted-in pool
 * anonymised (verified skills/levels, experience, city, availability — no
 * name, photo, headline, contact or badge certificate link, since the
 * certificate page shows the candidate's name), send an availability check
 * for one role, and see contact details only once the candidate says yes.
 * Nothing here touches the employer pipeline, matching, or badges.
 */
@Injectable()
export class StaffingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- candidate side ----------

  async getAvailability(userId: string) {
    const p = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: AVAILABILITY_SELECT });
    if (!p) throw new NotFoundException('Profile not found');
    return { ...p, fresh: isAvailabilityFresh(p.availabilityConfirmedAt), freshDays: AVAILABILITY_FRESH_DAYS };
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    const result = normaliseAvailability(dto);
    if ('error' in result) throw new BadRequestException(result.error);
    await this.prisma.candidateProfile.update({ where: { userId }, data: result.data });
    return this.getAvailability(userId);
  }

  async confirmAvailability(userId: string) {
    const p = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { openToStaffing: true } });
    if (!p) throw new NotFoundException('Profile not found');
    if (!p.openToStaffing) throw new BadRequestException('Turn on "Open to recruiters" first.');
    await this.prisma.candidateProfile.update({ where: { userId }, data: { availabilityConfirmedAt: new Date() } });
    return this.getAvailability(userId);
  }

  async listMyRequests(userId: string) {
    const profile = await this.ownProfile(userId);
    const rows = await this.prisma.staffingAvailabilityRequest.findMany({
      where: { candidateId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { organization: { select: { name: true } } },
    });
    const now = new Date();
    return rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      orgName: r.organization.name,
      roleTitle: r.roleTitle,
      summary: r.summary,
      workType: r.workType,
      rateMinInr: r.rateMinInr,
      rateMaxInr: r.rateMaxInr,
      rateUnit: r.rateUnit,
      location: r.location,
      remote: r.remote,
      clientName: r.clientName,
      clientIndustry: r.clientIndustry,
      status: effectiveStatus(r, now),
      candidateMessage: r.candidateMessage,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      respondedAt: r.respondedAt,
    }));
  }

  async respond(userId: string, requestId: string, dto: RespondStaffingRequestDto) {
    const profile = await this.ownProfile(userId);
    const r = await this.prisma.staffingAvailabilityRequest.findUnique({ where: { id: requestId } });
    if (!r || r.candidateId !== profile.id) throw new NotFoundException('Request not found');
    const status = effectiveStatus(r);
    if (status === 'EXPIRED') throw new ConflictException('This request has expired.');
    if (status !== StaffingRequestStatus.PENDING) throw new ConflictException('You have already answered this request.');

    const next = StaffingRequestStatus[dto.response];
    await this.prisma.staffingAvailabilityRequest.update({
      where: { id: r.id },
      data: { status: next, candidateMessage: dto.message?.trim() || null, respondedAt: new Date() },
    });
    if (dto.block) {
      await this.prisma.staffingBlock.upsert({
        where: { candidateId_orgId: { candidateId: profile.id, orgId: r.orgId } },
        create: { candidateId: profile.id, orgId: r.orgId },
        update: {},
      });
    }

    const subject =
      next === StaffingRequestStatus.NOT_NOW
        ? `A candidate isn't available for ${r.roleTitle}`
        : `A candidate is available for ${r.roleTitle}`;
    const html =
      next === StaffingRequestStatus.NOT_NOW
        ? `<p>The candidate you asked about for <strong>${esc(r.roleTitle)}</strong> isn't available right now.</p>`
        : `<p>The candidate you asked about for <strong>${esc(r.roleTitle)}</strong> is available${next === StaffingRequestStatus.CONDITIONAL ? ', with conditions' : ''}. Their contact details are now visible in MyAmbii.</p>` +
          `<p><a href="${WEB_BASE_URL}/employer/requests">Open availability requests</a></p>`;
    await this.notify(r.requestedByUserId, NotificationType.STAFFING_REQUEST_RESPONSE, subject, html);

    return { id: r.id, status: next };
  }

  async listMyBlocks(userId: string) {
    const profile = await this.ownProfile(userId);
    const rows = await this.prisma.staffingBlock.findMany({
      where: { candidateId: profile.id },
      include: { organization: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((b) => ({ orgId: b.orgId, orgName: b.organization.name, createdAt: b.createdAt }));
  }

  async unblock(userId: string, orgId: string) {
    const profile = await this.ownProfile(userId);
    await this.prisma.staffingBlock.deleteMany({ where: { candidateId: profile.id, orgId } });
    return { ok: true };
  }

  // ---------- staffing company side ----------

  async search(orgId: string, dto: SearchStaffingCandidatesDto) {
    const limit = Number(dto.limit ?? 20);
    const offset = Number(dto.offset ?? 0);
    const now = new Date();
    const levels = dto.minLevel ? LEVEL_ORDER.slice(LEVEL_ORDER.indexOf(dto.minLevel)) : undefined;

    const conditions: Prisma.CandidateProfileWhereInput[] = [
      candidateVisibilityFilter,
      { openToStaffing: true },
      { availabilityStatus: { not: AvailabilityStatus.NOT_LOOKING } },
      { availabilityConfirmedAt: { gte: new Date(now.getTime() - AVAILABILITY_FRESH_DAYS * DAY_MS) } },
      { skillClaims: { some: { status: ClaimStatus.VERIFIED } } },
      { staffingBlocks: { none: { orgId } } },
    ];
    if (dto.skillId || levels) {
      conditions.push({
        skillClaims: {
          some: {
            status: ClaimStatus.VERIFIED,
            ...(dto.skillId ? { skillId: dto.skillId } : {}),
            ...(levels ? { level: { in: levels } } : {}),
          },
        },
      });
    }
    if (dto.availableWithinDays != null) conditions.push(availableWithinWhere(Number(dto.availableWithinDays), now));
    if (dto.workType) conditions.push({ workTypes: { has: dto.workType } });
    const city = dto.city?.trim();
    if (city) {
      const inCity: Prisma.CandidateProfileWhereInput = {
        OR: [
          { locationCity: { contains: city, mode: 'insensitive' } },
          { locationLegacy: { contains: city, mode: 'insensitive' } },
        ],
      };
      conditions.push(dto.remoteOk === 'true' ? { OR: [inCity, { openToRemote: true }] } : inCity);
    }
    const where: Prisma.CandidateProfileWhereInput = { AND: conditions };

    const [total, profiles] = await Promise.all([
      this.prisma.candidateProfile.count({ where }),
      this.prisma.candidateProfile.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { availabilityConfirmedAt: 'desc' },
        select: {
          id: true,
          roleTitle: true,
          yearsOfExp: true,
          aiYearsOfExp: true,
          locationCity: true,
          locationRegion: true,
          locationCountry: true,
          openToRemote: true,
          ...AVAILABILITY_SELECT,
          skillClaims: { where: { status: ClaimStatus.VERIFIED }, select: { level: true, skill: { select: { id: true, name: true } } } },
          staffingRequests: {
            where: { orgId },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, expiresAt: true },
          },
        },
      }),
    ]);

    return {
      total,
      limit,
      offset,
      candidates: profiles.map((p) => ({
        candidateId: p.id,
        ref: candidateRef(p.id),
        roleTitle: p.roleTitle,
        yearsOfExp: p.yearsOfExp,
        aiYearsOfExp: p.aiYearsOfExp,
        // City-level only — never the street or coordinates.
        location: [p.locationCity, p.locationRegion, p.locationCountry].filter(Boolean).join(', ') || null,
        openToRemote: p.openToRemote,
        availabilityStatus: p.availabilityStatus,
        availableFrom: p.availableFrom,
        noticePeriodDays: p.noticePeriodDays,
        workTypes: p.workTypes,
        expectedRateMinInr: p.expectedRateMinInr,
        expectedRateMaxInr: p.expectedRateMaxInr,
        expectedRateUnit: p.expectedRateUnit,
        availabilityConfirmedAt: p.availabilityConfirmedAt,
        verifiedSkills: p.skillClaims.map((c) => ({ skillId: c.skill.id, skillName: c.skill.name, level: c.level })),
        lastRequest: p.staffingRequests[0]
          ? { id: p.staffingRequests[0].id, status: effectiveStatus(p.staffingRequests[0], now) }
          : null,
      })),
    };
  }

  async createRequest(orgId: string, userId: string, dto: CreateStaffingRequestDto) {
    const now = new Date();
    const candidate = await this.prisma.candidateProfile.findFirst({
      where: {
        id: dto.candidateId,
        ...candidateVisibilityFilter,
        openToStaffing: true,
        availabilityStatus: { not: AvailabilityStatus.NOT_LOOKING },
        staffingBlocks: { none: { orgId } },
      },
      select: { id: true, userId: true },
    });
    // One answer for "not opted in", "blocked you" and "doesn't exist" — never confirm which.
    if (!candidate) throw new NotFoundException('This candidate is not available for requests.');

    if (dto.rateMinInr != null && dto.rateMaxInr != null && dto.rateMinInr > dto.rateMaxInr) {
      throw new BadRequestException('The minimum rate is higher than the maximum.');
    }

    const open = await this.prisma.staffingAvailabilityRequest.findFirst({
      where: { orgId, candidateId: candidate.id, status: StaffingRequestStatus.PENDING, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (open) throw new ConflictException('You already have an open request with this candidate.');

    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [orgCount, candidateCount] = await Promise.all([
      this.prisma.staffingAvailabilityRequest.count({ where: { orgId, createdAt: { gte: weekAgo } } }),
      this.prisma.staffingAvailabilityRequest.count({ where: { candidateId: candidate.id, createdAt: { gte: weekAgo } } }),
    ]);
    if (orgCount >= ORG_WEEKLY_REQUEST_LIMIT) {
      throw new HttpException(`You've reached this week's limit of ${ORG_WEEKLY_REQUEST_LIMIT} availability requests.`, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (candidateCount >= CANDIDATE_WEEKLY_REQUEST_LIMIT) {
      throw new HttpException('This candidate has had several requests this week. Please try again in a few days.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const r = await this.prisma.staffingAvailabilityRequest.create({
      data: {
        orgId,
        requestedByUserId: userId,
        candidateId: candidate.id,
        roleTitle: dto.roleTitle.trim(),
        summary: dto.summary.trim(),
        workType: dto.workType,
        rateMinInr: dto.rateMinInr ?? null,
        rateMaxInr: dto.rateMaxInr ?? null,
        rateUnit: dto.rateMinInr != null || dto.rateMaxInr != null ? dto.rateUnit ?? null : null,
        location: dto.location?.trim() || null,
        remote: dto.remote ?? false,
        clientName: dto.clientName?.trim() || null,
        clientIndustry: dto.clientIndustry?.trim() || null,
        expiresAt: new Date(now.getTime() + REQUEST_TTL_HOURS * 60 * 60 * 1000),
      },
      include: { organization: { select: { name: true } } },
    });

    await this.notify(
      candidate.userId,
      NotificationType.STAFFING_AVAILABILITY_REQUEST,
      `${r.organization.name} asked if you're available: ${r.roleTitle}`,
      `<p><strong>${esc(r.organization.name)}</strong>, a verified recruiter, wants to know if you're available for <strong>${esc(r.roleTitle)}</strong>.</p>` +
        `<p>They can't see your name or contact details unless you say yes. Please answer within ${REQUEST_TTL_HOURS} hours.</p>` +
        `<p><a href="${WEB_BASE_URL}/interviews">See the request</a></p>`,
    );

    return { id: r.id, status: r.status, expiresAt: r.expiresAt };
  }

  async listOrgRequests(orgId: string) {
    const rows = await this.prisma.staffingAvailabilityRequest.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        candidateProfile: {
          select: {
            id: true,
            fullName: true,
            headline: true,
            roleTitle: true,
            linkedinUrl: true,
            githubUrl: true,
            locationCity: true,
            locationCountry: true,
            deletedAt: true,
            deactivatedAt: true,
            isInternalTestAccount: true,
            user: { select: { email: true, phone: true } },
          },
        },
      },
    });
    const now = new Date();
    return rows.map((r) => {
      const status = effectiveStatus(r, now);
      const c = r.candidateProfile;
      const stillVisible = !c.deletedAt && !c.deactivatedAt && !c.isInternalTestAccount;
      return {
        id: r.id,
        candidateId: c.id,
        ref: candidateRef(c.id),
        roleTitle: r.roleTitle,
        workType: r.workType,
        clientName: r.clientName,
        status,
        candidateMessage: r.candidateMessage,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        respondedAt: r.respondedAt,
        candidateRoleTitle: c.roleTitle,
        candidateLocation: [c.locationCity, c.locationCountry].filter(Boolean).join(', ') || null,
        // Read live, only after a yes, and only while the candidate is still on the platform.
        contact:
          revealsContact(status) && stillVisible
            ? {
                fullName: c.fullName,
                headline: c.headline,
                email: c.user.email,
                phone: c.user.phone,
                linkedinUrl: c.linkedinUrl,
                githubUrl: c.githubUrl,
              }
            : null,
      };
    });
  }

  async withdraw(orgId: string, requestId: string) {
    const r = await this.prisma.staffingAvailabilityRequest.findUnique({ where: { id: requestId } });
    if (!r || r.orgId !== orgId) throw new NotFoundException('Request not found');
    if (effectiveStatus(r) !== StaffingRequestStatus.PENDING) throw new ConflictException('Only an open request can be withdrawn.');
    await this.prisma.staffingAvailabilityRequest.update({ where: { id: r.id }, data: { status: StaffingRequestStatus.WITHDRAWN } });
    return { id: r.id, status: StaffingRequestStatus.WITHDRAWN };
  }

  // ---------- helpers ----------

  private async ownProfile(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  /** Best-effort, same contract as every other NotificationsService caller. */
  private async notify(userId: string, type: NotificationType, subject: string, html: string) {
    try {
      await this.notifications.sendEmail(userId, type, subject, html);
    } catch {
      // NotificationsService already swallows its own errors; defence in depth.
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
