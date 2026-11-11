import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  ShortlistStage,
  StaffingRequestStatus,
  StaffingSubmissionStatus as S,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { candidateVisibilityFilter } from '../account/account.util';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { candidateRef } from './staffing.util';
import {
  CONSENT_TTL_HOURS,
  ClientKey,
  PLACEMENT_PROTECTION_DAYS,
  candidateCanWithdraw,
  effectiveSubmissionStatus,
  isRepresentationActive,
  normaliseClientName,
  normaliseDomain,
  orgCanMove,
  sameClient,
} from './staffing-representation.util';
import { CreateStaffingClientDto, CreateStaffingSubmissionDto, DecideSubmissionDto, UpdateStaffingClientDto } from './staffing-submissions.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE_PIPELINE: ShortlistStage[] = [ShortlistStage.SHORTLISTED, ShortlistStage.INVITED, ShortlistStage.INTERVIEWING, ShortlistStage.OFFER];

const STATUS_WORDS: Partial<Record<S, string>> = {
  INTERVIEWING: 'is interviewing you',
  OFFER: 'has an offer for you',
  PLACED: 'has confirmed your placement',
  NOT_SELECTED: "didn't select you this time",
  WITHDRAWN: 'withdrew your submission',
};

/**
 * Staffing Phase 2a: a staffing company's client list, and putting a
 * candidate forward to a client. Every submission needs the candidate's
 * consent (they see the client's name first). Once consented, the company
 * represents the candidate to that client (see isRepresentationActive) and
 * no other company can submit them there — matched on the client's
 * normalised name or website domain. A client where the candidate is
 * already in a MyAmbii employer's own pipeline (applied, or on its
 * shortlist) can't be submitted to at all: that relationship is direct.
 * The conflict message never says which company holds the representation.
 */
@Injectable()
export class StaffingSubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- clients ----------

  listClients(orgId: string, includeArchived = false) {
    return this.prisma.staffingClient.findMany({
      where: { orgId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, industry: true, website: true, archivedAt: true, createdAt: true },
    });
  }

  async createClient(orgId: string, dto: CreateStaffingClientDto) {
    const name = dto.name.trim();
    try {
      return await this.prisma.staffingClient.create({
        data: {
          orgId,
          name,
          nameKey: normaliseClientName(name),
          industry: dto.industry?.trim() || null,
          website: dto.website?.trim() || null,
          domain: normaliseDomain(dto.website),
        },
        select: { id: true, name: true, industry: true, website: true, archivedAt: true, createdAt: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You already have a client with this name.');
      }
      throw err;
    }
  }

  async updateClient(orgId: string, id: string, dto: UpdateStaffingClientDto) {
    const client = await this.prisma.staffingClient.findUnique({ where: { id } });
    if (!client || client.orgId !== orgId) throw new NotFoundException('Client not found');
    const name = dto.name?.trim();
    try {
      return await this.prisma.staffingClient.update({
        where: { id },
        data: {
          ...(name ? { name, nameKey: normaliseClientName(name) } : {}),
          ...(dto.industry !== undefined ? { industry: dto.industry.trim() || null } : {}),
          ...(dto.website !== undefined ? { website: dto.website.trim() || null, domain: normaliseDomain(dto.website) } : {}),
          ...(dto.archived !== undefined ? { archivedAt: dto.archived ? new Date() : null } : {}),
        },
        select: { id: true, name: true, industry: true, website: true, archivedAt: true, createdAt: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You already have a client with this name.');
      }
      throw err;
    }
  }

  // ---------- submissions: staffing company ----------

  async createSubmission(orgId: string, userId: string, dto: CreateStaffingSubmissionDto) {
    const now = new Date();
    const client = await this.prisma.staffingClient.findUnique({ where: { id: dto.clientId } });
    if (!client || client.orgId !== orgId || client.archivedAt) throw new NotFoundException('Client not found');

    const candidate = await this.prisma.candidateProfile.findFirst({
      where: { id: dto.candidateId, ...candidateVisibilityFilter },
      select: { id: true, userId: true },
    });
    if (!candidate) throw new NotFoundException('This candidate is not available.');

    const [agreed, applied] = await Promise.all([
      this.prisma.staffingAvailabilityRequest.findFirst({
        where: {
          orgId,
          candidateId: candidate.id,
          status: { in: [StaffingRequestStatus.AVAILABLE, StaffingRequestStatus.CONDITIONAL] },
        },
        select: { id: true },
      }),
      // Applying to one of this recruiter's agency postings shares the
      // candidate's details with them, so it counts like saying "available".
      // The candidate still approves the submission itself (consent below).
      this.prisma.application.findFirst({
        where: { candidateProfileId: candidate.id, job: { orgId } },
        select: { id: true },
      }),
    ]);
    if (!agreed && !applied) {
      throw new ForbiddenException('You can only submit candidates who told you they are available or applied to one of your jobs.');
    }

    if (dto.projectRoleId) {
      const role = await this.prisma.projectRole.findFirst({
        where: { id: dto.projectRoleId, project: { orgId } },
        select: { project: { select: { clientId: true } } },
      });
      if (!role) throw new NotFoundException('Project role not found');
      if (role.project.clientId !== client.id) {
        throw new BadRequestException("That project role is for a different client.");
      }
    }

    const key: ClientKey = { nameKey: client.nameKey, domain: client.domain };
    const own = await this.prisma.staffingSubmission.findMany({
      where: { orgId, candidateId: candidate.id, clientId: client.id },
      select: { status: true, consentExpiresAt: true, consentedAt: true, statusUpdatedAt: true },
    });
    if (own.some((s) => effectiveSubmissionStatus(s, now) === S.PENDING_CONSENT || isRepresentationActive(s, now))) {
      throw new ConflictException('You have already submitted this candidate to this client.');
    }
    await this.assertNoConflict(candidate.id, key, orgId, now);

    const sub = await this.prisma.staffingSubmission.create({
      data: {
        orgId,
        clientId: client.id,
        candidateId: candidate.id,
        createdByUserId: userId,
        roleTitle: dto.roleTitle.trim(),
        projectRoleId: dto.projectRoleId ?? null,
        clientNameKey: client.nameKey,
        clientDomain: client.domain,
        consentExpiresAt: new Date(now.getTime() + CONSENT_TTL_HOURS * 60 * 60 * 1000),
      },
      include: { organization: { select: { name: true } } },
    });

    await this.notify(
      candidate.userId,
      NotificationType.STAFFING_SUBMISSION_CONSENT,
      `${sub.organization.name} wants to put you forward to ${client.name}`,
      `<p><strong>${esc(sub.organization.name)}</strong> would like to submit you to <strong>${esc(client.name)}</strong> for <strong>${esc(sub.roleTitle)}</strong>.</p>` +
        `<p>They'll only do this if you approve. While they represent you there, no other recruiter can submit you to ${esc(client.name)}. Please decide within ${CONSENT_TTL_HOURS} hours.</p>` +
        `<p><a href="${WEB_BASE_URL}/interviews">Review the request</a></p>`,
    );
    return { id: sub.id, status: sub.status, consentExpiresAt: sub.consentExpiresAt };
  }

  async listOrgSubmissions(orgId: string) {
    const now = new Date();
    const rows = await this.prisma.staffingSubmission.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: {
        client: { select: { id: true, name: true } },
        candidateProfile: { select: { id: true, fullName: true, deletedAt: true, deactivatedAt: true } },
      },
    });
    return rows.map((s) => ({
      id: s.id,
      client: s.client,
      projectRoleId: s.projectRoleId,
      candidateId: s.candidateId,
      // The candidate already said yes to this company, so the name is known to it.
      candidateName: !s.candidateProfile.deletedAt && !s.candidateProfile.deactivatedAt ? s.candidateProfile.fullName : null,
      ref: candidateRef(s.candidateId),
      roleTitle: s.roleTitle,
      status: effectiveSubmissionStatus(s, now),
      representationActive: isRepresentationActive(s, now),
      candidateNote: s.candidateNote,
      consentExpiresAt: s.consentExpiresAt,
      consentedAt: s.consentedAt,
      statusUpdatedAt: s.statusUpdatedAt,
      createdAt: s.createdAt,
    }));
  }

  async updateStatus(orgId: string, id: string, to: S) {
    const now = new Date();
    const sub = await this.prisma.staffingSubmission.findUnique({
      where: { id },
      include: { client: { select: { name: true } }, organization: { select: { name: true } }, candidateProfile: { select: { userId: true } } },
    });
    if (!sub || sub.orgId !== orgId) throw new NotFoundException('Submission not found');
    const from = effectiveSubmissionStatus(sub, now);
    if (from === 'EXPIRED' || !orgCanMove(from, to)) {
      throw new ConflictException(`A submission that is ${String(from).toLowerCase().replace(/_/g, ' ')} can't be moved to ${to.toLowerCase().replace(/_/g, ' ')}.`);
    }
    await this.prisma.staffingSubmission.update({ where: { id }, data: { status: to, statusUpdatedAt: now } });

    const words = STATUS_WORDS[to];
    if (words) {
      await this.notify(
        sub.candidateProfile.userId,
        NotificationType.STAFFING_SUBMISSION_STATUS,
        `Update on ${sub.roleTitle} at ${sub.client.name}`,
        `<p>Through <strong>${esc(sub.organization.name)}</strong>: <strong>${esc(sub.client.name)}</strong> ${words} for <strong>${esc(sub.roleTitle)}</strong>.</p>` +
          `<p><a href="${WEB_BASE_URL}/interviews">See your submissions</a></p>`,
      );
    }
    return { id, status: to };
  }

  // ---------- submissions: candidate ----------

  async listMySubmissions(userId: string) {
    const profile = await this.ownProfile(userId);
    const now = new Date();
    const rows = await this.prisma.staffingSubmission.findMany({
      where: { candidateId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { client: { select: { name: true, industry: true } }, organization: { select: { name: true } } },
    });
    return rows.map((s) => ({
      id: s.id,
      orgName: s.organization.name,
      clientName: s.client.name,
      clientIndustry: s.client.industry,
      roleTitle: s.roleTitle,
      status: effectiveSubmissionStatus(s, now),
      representationActive: isRepresentationActive(s, now),
      consentExpiresAt: s.consentExpiresAt,
      consentedAt: s.consentedAt,
      statusUpdatedAt: s.statusUpdatedAt,
      candidateNote: s.candidateNote,
    }));
  }

  async decide(userId: string, id: string, dto: DecideSubmissionDto) {
    const profile = await this.ownProfile(userId);
    const now = new Date();
    const sub = await this.prisma.staffingSubmission.findUnique({
      where: { id },
      include: { client: { select: { name: true } } },
    });
    if (!sub || sub.candidateId !== profile.id) throw new NotFoundException('Submission not found');
    const status = effectiveSubmissionStatus(sub, now);
    if (status === 'EXPIRED') throw new ConflictException('This request has expired.');
    if (status !== S.PENDING_CONSENT) throw new ConflictException('You have already answered this request.');

    if (dto.approve) {
      // Re-checked at consent time: another company may have been approved for this client meanwhile.
      await this.assertNoConflict(profile.id, { nameKey: sub.clientNameKey, domain: sub.clientDomain }, sub.orgId, now, true);
    }
    const next = dto.approve ? S.SUBMITTED : S.DECLINED;
    await this.prisma.staffingSubmission.update({
      where: { id },
      data: {
        status: next,
        consentedAt: dto.approve ? now : null,
        statusUpdatedAt: now,
        candidateNote: dto.note?.trim() || null,
      },
    });
    await this.notify(
      sub.createdByUserId,
      NotificationType.STAFFING_SUBMISSION_DECISION,
      dto.approve ? `Approved: submit to ${sub.client.name}` : `Declined: submission to ${sub.client.name}`,
      dto.approve
        ? `<p>The candidate approved being submitted to <strong>${esc(sub.client.name)}</strong> for <strong>${esc(sub.roleTitle)}</strong>. You now represent them there for 30 days, or longer while they're interviewing.</p><p><a href="${WEB_BASE_URL}/employer/submissions">Open submissions</a></p>`
        : `<p>The candidate declined being submitted to <strong>${esc(sub.client.name)}</strong> for <strong>${esc(sub.roleTitle)}</strong>.</p>`,
    );
    return { id, status: next };
  }

  async candidateWithdraw(userId: string, id: string) {
    const profile = await this.ownProfile(userId);
    const sub = await this.prisma.staffingSubmission.findUnique({ where: { id }, include: { client: { select: { name: true } } } });
    if (!sub || sub.candidateId !== profile.id) throw new NotFoundException('Submission not found');
    if (!candidateCanWithdraw(sub.status)) throw new ConflictException('This submission can no longer be withdrawn.');
    await this.prisma.staffingSubmission.update({ where: { id }, data: { status: S.WITHDRAWN, statusUpdatedAt: new Date() } });
    await this.notify(
      sub.createdByUserId,
      NotificationType.STAFFING_SUBMISSION_DECISION,
      `Withdrawn: submission to ${sub.client.name}`,
      `<p>The candidate withdrew their consent to be represented to <strong>${esc(sub.client.name)}</strong> for <strong>${esc(sub.roleTitle)}</strong>.</p>`,
    );
    return { id, status: S.WITHDRAWN };
  }

  // ---------- rules ----------

  /**
   * Throws if another staffing company currently represents this candidate
   * to the same client, or the candidate is already in that company's own
   * MyAmbii hiring process. Never names the other staffing company.
   */
  private async assertNoConflict(candidateId: string, key: ClientKey, ownOrgId: string, now: Date, forCandidate = false) {
    const others = await this.prisma.staffingSubmission.findMany({
      where: {
        candidateId,
        orgId: { not: ownOrgId },
        status: { in: [S.SUBMITTED, S.INTERVIEWING, S.OFFER, S.PLACED] },
        OR: [{ clientNameKey: key.nameKey }, ...(key.domain ? [{ clientDomain: key.domain }] : [])],
      },
      select: { status: true, consentedAt: true, statusUpdatedAt: true },
    });
    if (others.some((s) => isRepresentationActive(s, now))) {
      throw new ConflictException(
        forCandidate
          ? "You're already represented to this client by another recruiter, so this one can't submit you there."
          : 'This candidate is already represented to this client by another recruiter.',
      );
    }

    const since = new Date(now.getTime() - PLACEMENT_PROTECTION_DAYS * DAY_MS);
    const [entries, applications] = await Promise.all([
      this.prisma.shortlistEntry.findMany({
        where: { candidateId, stage: { in: LIVE_PIPELINE } },
        select: { organization: { select: { name: true, website: true } } },
      }),
      this.prisma.application.findMany({
        where: { candidateProfileId: candidateId, createdAt: { gte: since } },
        select: { job: { select: { organization: { select: { name: true, website: true } } } } },
      }),
    ]);
    const direct = [...entries.map((e) => e.organization), ...applications.map((a) => a.job.organization)];
    if (direct.some((o) => sameClient(key, { nameKey: normaliseClientName(o.name), domain: normaliseDomain(o.website) }))) {
      throw new ConflictException(
        forCandidate
          ? "You're already in this company's own hiring process on MyAmbii, so a recruiter can't submit you there."
          : "This candidate is already in this company's own hiring process on MyAmbii, so they can't be submitted there.",
      );
    }
  }

  private async ownProfile(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  private async notify(userId: string, type: NotificationType, subject: string, html: string) {
    try {
      await this.notifications.sendEmail(userId, type, subject, html);
    } catch {
      // best-effort, like every other NotificationsService caller
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
