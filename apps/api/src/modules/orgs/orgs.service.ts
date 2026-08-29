import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'path';
import { CandidateOfferResponse, JobStatus, NotificationType, OrgVerificationStatus, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderNotificationEmail } from '../notifications/notification-email.template';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { DeactivateOrgDto, UpdateOrgDto } from './orgs.dto';
import { notifyOrgMembers } from './notify-org-members';

/** Same convention as ProfilesController's PHOTO_EXTENSION_BY_MIME, inverted for read-back — every key OrgsController's fileFilter accepts has an entry here. */
const LOGO_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Storage key is never returned to a client — same masking as ProfilesService.withHasPhoto. */
function withHasLogo<T extends { logoKey: string | null }>(org: T): Omit<T, 'logoKey'> & { hasLogo: boolean } {
  const { logoKey, ...rest } = org;
  return { ...rest, hasLogo: logoKey != null };
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async update(orgId: string, dto: UpdateOrgDto) {
    const updated = await this.prisma.organization.update({ where: { id: orgId }, data: dto });
    return withHasLogo(updated);
  }

  /** Replaces the stored logo, deleting the previous file first — same "don't accumulate unreferenced files" rule as ProfilesService.savePhoto. */
  async saveLogo(orgId: string, key: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.logoKey) await this.deleteStoredFile(org.logoKey);
    const updated = await this.prisma.organization.update({ where: { id: orgId }, data: { logoKey: key } });
    return withHasLogo(updated);
  }

  /**
   * Employer-admin-initiated. Moves UNVERIFIED or REJECTED -> PENDING for
   * an admin to decide (see OrgVerificationStatus). Also covers a
   * REJECTED org's resubmission after fixing whatever the admin flagged —
   * the prior decision fields are cleared here so a stale rejectionReason
   * never sits alongside a fresh PENDING review (see Organization's own
   * doc comment on those fields).
   */
  async submitForVerification(orgId: string, userId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.verificationStatus === OrgVerificationStatus.PENDING) {
      throw new ConflictException('Verification is already pending review.');
    }
    if (org.verificationStatus === OrgVerificationStatus.VERIFIED) {
      throw new ConflictException('This organization is already verified.');
    }

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        verificationStatus: OrgVerificationStatus.PENDING,
        verificationSubmittedAt: new Date(),
        verificationSubmittedByUserId: userId,
        verifiedAt: null,
        verifiedByUserId: null,
        rejectionReason: null,
      },
    });
    return withHasLogo(updated);
  }

  /**
   * Powers the "this will unpublish N live jobs and notify M applicants"
   * confirmation copy — computed before anything is touched. Mirrors
   * JobsService.notifyJobUnpublished's own recipient rule (applicants plus
   * still-active shortlist entries, excluding HIRED/accepted-OFFER) but
   * aggregated across every live job at once instead of one job at a
   * time. Doesn't replicate that method's own per-job "already notified"
   * idempotency dedup — a small, accepted overcount in the rare
   * unpublish-then-republish-then-deactivate sequence is fine for a
   * confirmation estimate ahead of a destructive action; erring high is
   * the safer direction for that specific number.
   */
  async previewDeactivationImpact(orgId: string) {
    const liveJobs = await this.prisma.job.findMany({
      where: { orgId, status: JobStatus.LIVE },
      select: { id: true },
    });
    if (liveJobs.length === 0) return { liveJobCount: 0, applicantCount: 0 };

    const jobIds = liveJobs.map((j) => j.id);
    const [applicants, shortlisted] = await Promise.all([
      this.prisma.application.findMany({
        where: { jobId: { in: jobIds } },
        select: { candidateProfile: { select: { userId: true } } },
      }),
      this.prisma.shortlistEntry.findMany({
        where: {
          jobId: { in: jobIds },
          NOT: {
            OR: [
              { stage: ShortlistStage.HIRED },
              { stage: ShortlistStage.OFFER, candidateResponse: CandidateOfferResponse.ACCEPTED },
            ],
          },
        },
        select: { candidateProfile: { select: { userId: true } } },
      }),
    ]);

    const applicantCount = new Set([
      ...applicants.map((a) => a.candidateProfile.userId),
      ...shortlisted.map((s) => s.candidateProfile.userId),
    ]).size;

    return { liveJobCount: jobIds.length, applicantCount };
  }

  /**
   * EMPLOYER_ADMIN-triggered, immediate — no approval workflow. Blocks the
   * whole org (see OrgActiveGuard, embedded in OrgMemberGuard) and
   * unpublishes every live job by calling JobsService.update per job —
   * reuses its exact LIVE->CLOSED detection and JOB_UNPUBLISHED
   * notification (JobsService.notifyJobUnpublished) rather than a
   * parallel implementation. deactivatedAt/-ByUserId are written FIRST,
   * before the job-closing loop, so a failure partway through still
   * leaves the org correctly blocked instead of looking like nothing
   * happened.
   *
   * Irreversible in one respect worth being explicit about in every piece
   * of copy this touches: reactivation (platform-admin only, see
   * AdminService.reactivateOrg) restores portal access, but never
   * re-opens the jobs this closed — applicants have already been told
   * those roles are no longer accepting applications, and re-opening one
   * is a deliberate employer action, not an automatic side effect of
   * being let back in.
   */
  async deactivate(orgId: string, userId: string, dto: DeactivateOrgDto) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.deactivatedAt) {
      throw new ConflictException('This organization is already deactivated.');
    }
    if (dto.confirmOrgName.trim() !== org.name) {
      throw new BadRequestException(
        "Type your organization's exact name to confirm — this is immediate and affects your whole team.",
      );
    }

    const liveJobs = await this.prisma.job.findMany({
      where: { orgId, status: JobStatus.LIVE },
      select: { id: true },
    });

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { deactivatedAt: new Date(), deactivatedByUserId: userId },
    });

    for (const job of liveJobs) {
      await this.jobs.update(orgId, job.id, { status: JobStatus.CLOSED });
    }

    const jobCountLabel = `${liveJobs.length} live job${liveJobs.length === 1 ? '' : 's'}`;
    await notifyOrgMembers(
      this.prisma,
      this.notifications,
      orgId,
      NotificationType.ORG_DEACTIVATED,
      'Your organization has been deactivated on MyAmbii',
      renderNotificationEmail(
        `<p><strong>${escapeHtml(org.name)}</strong> has been deactivated. Every team member has lost access to ` +
          `the employer portal, and ${jobCountLabel} ${liveJobs.length === 1 ? 'has' : 'have'} been unpublished — ` +
          `applicants have already been notified their applications are no longer being accepted.</p>` +
          `<p>Reactivation is only available through MyAmbii support; there is no self-service option. Unpublished ` +
          `jobs stay closed even after reactivation — they are not automatically reopened.</p>`,
        { label: 'Contact support', url: `${WEB_BASE_URL}/contact` },
      ),
    );

    return { ...withHasLogo(updated), unpublishedJobCount: liveJobs.length };
  }

  async deleteLogo(orgId: string) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.logoKey) await this.deleteStoredFile(org.logoKey);
    const updated = await this.prisma.organization.update({ where: { id: orgId }, data: { logoKey: null } });
    return withHasLogo(updated);
  }

  /**
   * GET /orgs/:id/logo. `callerOrgId` comes from OrgMemberGuard (the
   * requester's own membership, resolved server-side from their JWT — never
   * trusted from the URL); `orgId` is the :id param. Any member of an org
   * may view that org's own logo, but never another org's — there's no
   * legitimate cross-org logo access in this feature (unlike candidate
   * photos, which an employer may view for an applicant relationship — a
   * logo has no equivalent relationship to check, so same-org is the whole
   * rule).
   */
  async getLogoForViewing(orgId: string): Promise<{ buffer: Buffer; contentType: string }> {

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException();
    if (!org.logoKey) throw new NotFoundException('No logo set for this organization.');

    try {
      const buffer = await this.storage.read(org.logoKey);
      return { buffer, contentType: this.contentTypeFor(org.logoKey) };
    } catch {
      throw new NotFoundException('Stored logo could not be read.');
    }
  }

  private contentTypeFor(filename: string): string {
    return LOGO_CONTENT_TYPE_BY_EXTENSION[extname(filename).toLowerCase()] ?? 'application/octet-stream';
  }

  /** Best-effort — a file already missing in storage shouldn't block clearing or replacing the DB pointer. Same reasoning as ProfilesService.deleteStoredFile. */
  private async deleteStoredFile(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      // Ignored — see doc comment above.
    }
  }
}

/** Employer-authored free text (org name) landing in an HTML email body — same local escape as JobsService's own, not shared, since neither module exports one today. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
