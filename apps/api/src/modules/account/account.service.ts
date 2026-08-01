import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountActionType, NotificationType, Prisma, ShortlistStage } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderNotificationEmail } from '../notifications/notification-email.template';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { UPLOAD_DIR } from '../../config/upload-dir';
import { DeactivateAccountDto, DeleteAccountDto } from './account.dto';

/** A live pipeline is one an employer is actively waiting on the candidate for — SHORTLISTED alone isn't (the employer hasn't reached out), and the terminal stages need no transition at all. */
const LIVE_PIPELINE_STAGES: ShortlistStage[] = [ShortlistStage.INVITED, ShortlistStage.INTERVIEWING, ShortlistStage.OFFER];
/** Applications an employer could still act on — REJECTED/WITHDRAWN are already terminal and left alone. */
const PENDING_APPLICATION_STATUSES = ['APPLIED', 'REVIEWED', 'SHORTLISTED'] as const;

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getStatus(userId: string) {
    const profile = await this.getOwnedProfile(userId);
    return { deactivated: profile.deactivatedAt !== null, deactivatedAt: profile.deactivatedAt };
  }

  /**
   * Reversible. Sets deactivatedAt (candidateVisibilityFilter — see
   * account.util.ts — is what actually hides the candidate from search/
   * matching/digests everywhere else; this method's only job is to set the
   * one field that filter reads, plus everything that isn't a passive
   * read-time filter: live pipelines, pending applications, and the
   * confirmation email).
   */
  async deactivate(userId: string, dto: DeactivateAccountDto) {
    const profile = await this.getOwnedProfile(userId);
    if (profile.deletedAt) throw new ConflictException('This account has been deleted and cannot be deactivated.');
    if (profile.deactivatedAt) throw new ConflictException('This account is already deactivated.');

    await this.prisma.candidateProfile.update({
      where: { id: profile.id },
      data: { deactivatedAt: new Date() },
    });

    await this.makeCandidateUnavailableToEmployers(profile.id);

    await this.prisma.accountAction.create({
      data: {
        candidateProfileId: profile.id,
        type: AccountActionType.DEACTIVATED,
        reasonCategory: dto.reasonCategory,
        reasonText: dto.reasonText,
      },
    });

    await this.notifications.sendEmail(
      userId,
      NotificationType.ACCOUNT_DEACTIVATED,
      'Your SkillProof account is deactivated',
      renderNotificationEmail(
        `<p>Your account is now deactivated — your profile is hidden from employer search and matching, and you won't be newly shortlisted or invited while it's off.</p>` +
          `<p>Everything is still there. Sign back in any time to reactivate.</p>`,
        { label: 'Sign in to SkillProof', url: WEB_BASE_URL },
      ),
    );

    return this.getStatus(userId);
  }

  /**
   * Restores exactly what deactivate() touched: candidateVisibilityFilter
   * passes again the instant deactivatedAt clears, and every pipeline this
   * candidate's own deactivation moved to CANDIDATE_UNAVAILABLE reverts to
   * whatever it was before (preUnavailableStage). Pending applications that
   * were withdrawn on deactivation deliberately do NOT auto-restore — see
   * this method's own note below on why that's a one-way door.
   */
  async reactivate(userId: string) {
    const profile = await this.getOwnedProfile(userId);
    if (profile.deletedAt) throw new ConflictException('This account has been deleted and cannot be reactivated.');
    if (!profile.deactivatedAt) throw new ConflictException('This account is not deactivated.');

    await this.prisma.candidateProfile.update({
      where: { id: profile.id },
      data: { deactivatedAt: null },
    });

    const stranded = await this.prisma.shortlistEntry.findMany({
      where: { candidateId: profile.id, stage: ShortlistStage.CANDIDATE_UNAVAILABLE, preUnavailableStage: { not: null } },
      select: { id: true, preUnavailableStage: true },
    });
    for (const entry of stranded) {
      await this.prisma.shortlistEntry.update({
        where: { id: entry.id },
        // preUnavailableStage is guaranteed non-null by the query above — non-null assertion is safe here, not a widened type.
        data: { stage: entry.preUnavailableStage!, preUnavailableStage: null },
      });
    }

    // Applications withdrawn by deactivate() are NOT restored here. Unlike a
    // pipeline (which an employer actively moved the candidate into),
    // "APPLIED" was the candidate's own one-time action — silently
    // resurrecting it days or weeks later as if newly submitted would
    // surprise the employer more than it would help the candidate, who can
    // just reapply if the role is still open. A live pipeline mid-process
    // is different: nobody "re-invites themselves" by reactivating.

    await this.prisma.accountAction.create({
      data: { candidateProfileId: profile.id, type: AccountActionType.REACTIVATED },
    });

    return this.getStatus(userId);
  }

  /**
   * Permanent. Never a real SQL delete — see the audit this was built from:
   * every FK from CandidateProfile/User downward is ON DELETE RESTRICT (no
   * CASCADE anywhere in this schema), so a literal delete() would either
   * throw immediately or, if every dependent row were removed first,
   * destroy employer-owned hiring history that has nothing to do with this
   * candidate's own right to erasure. "Delete" here means: anonymize every
   * PII-bearing column in place, remove the stored files, and leave every
   * row (and every id every other table references) exactly where it is.
   */
  async delete(userId: string, dto: DeleteAccountDto) {
    if (dto.confirmation !== 'DELETE') {
      throw new ConflictException('Type DELETE to confirm — this action is permanent.');
    }
    const profile = await this.getOwnedProfile(userId);
    if (profile.deletedAt) throw new ConflictException('This account has already been deleted.');

    // Sent first, deliberately, before anything below touches the email
    // column — this is the last email this account will ever receive, and
    // NotificationsService.sendEmail silently no-ops for a user with no
    // email on file, which is exactly what user.email would be one step
    // from now.
    await this.notifications.sendEmail(
      userId,
      NotificationType.ACCOUNT_DELETED,
      'Your SkillProof account has been deleted',
      renderNotificationEmail(
        `<p>Your SkillProof account and personal data have been deleted, as you requested. This can't be undone.</p>` +
          `<p>Any verified skill badge you earned stays independently verifiable to anyone who already has the link — it's shown without your name attached.</p>` +
          `<p>If this wasn't you, or you didn't mean to, please contact support right away.</p>`,
        { label: 'Visit SkillProof', url: WEB_BASE_URL },
      ),
    );

    await this.makeCandidateUnavailableToEmployers(profile.id);
    await this.deleteStoredFiles(profile.id, profile.photoKey, profile.resumeS3Key);

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.candidateProfile.update({
        where: { id: profile.id },
        data: {
          deletedAt: now,
          fullName: null,
          headline: null,
          locationCity: null,
          locationRegion: null,
          locationCountry: null,
          locationPlaceId: null,
          locationLat: null,
          locationLng: null,
          locationLegacy: null,
          githubUrl: null,
          linkedinUrl: null,
          roleTitle: null,
          roleTitleOther: null,
          photoKey: null,
          resumeS3Key: null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { email: null, phone: null },
      }),
      // OAuth links and refresh tokens are the candidate's own auth
      // artifacts with no employer-facing meaning and nothing downstream
      // referencing them — unlike everything above, these are safe to
      // actually remove rather than anonymize.
      this.prisma.identity.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
      // External credentials/certifications can carry a name or a personal
      // profile URL (a Credly badge page, a LinkedIn Learning cert link) —
      // same category of personal data as the profile fields above, so the
      // identifying columns are cleared the same way; issuer/status/dates/
      // skillTags stay (nothing identifying, and an employer who already
      // shortlisted this candidate keeps an honest record of what was
      // verified).
      this.prisma.externalCredential.updateMany({
        where: { profileId: profile.id },
        // Json field: `null`/`undefined` mean different things than a plain
        // TS null would suggest — Prisma.DbNull is the real SQL NULL, which
        // matches "no metadata" (most rows' un-set default) rather than
        // Prisma.JsonNull's literal JSON `null` value.
        data: { name: null, credentialUrl: '', rawMetadata: Prisma.DbNull },
      }),
      this.prisma.certification.updateMany({
        where: { profileId: profile.id },
        data: { name: '[deleted]', issuerOther: null, credentialId: null, credentialUrl: null, fileUrl: null },
      }),
      // The one place a prior action's free text survives past a later
      // deletion otherwise — see AccountAction's own doc comment. Reaches
      // every row for this candidate, not just the one this call is about
      // to create, since an earlier deactivation's reasonText is exactly
      // as much "personal data" as anything else here.
      this.prisma.accountAction.updateMany({
        where: { candidateProfileId: profile.id },
        data: { reasonText: null },
      }),
      this.prisma.accountAction.create({
        data: {
          candidateProfileId: profile.id,
          type: AccountActionType.DELETED,
          reasonCategory: dto.reasonCategory,
          // Not dto.reasonText — this row is created inside the same
          // transaction as the updateMany above that nulls every existing
          // row's reasonText; writing the raw text here would just leave
          // exactly one row un-anonymized by the time the transaction
          // commits. reasonCategory is unaffected — it was never scrubbed.
        },
      }),
    ]);

    // ---- Seam for feat/employer-triggered-assessment (not merged) ----
    // That branch adds AssessmentRequest with a PAID_PENDING_START status
    // and an expiry job that refunds an employer's payment if the
    // candidate never starts within 5 days (see that branch's own
    // AssessmentRequestsService). Once merged, this method should find
    // this candidate's requests still in PAID_PENDING_START/REFUND_FAILED
    // and immediately trigger that same refund path — an employer who paid
    // for a specific candidate to be assessed shouldn't wait out 5 days to
    // find out that candidate deleted their account and is never starting
    // it. Intentionally not stubbed further than this comment: there's no
    // AssessmentRequest model on this branch to reference yet, and a fake
    // placeholder call would just be dead code until the real one merges.

    return { deleted: true };
  }

  /** Admin-visible per the product-insight requirement this table exists for — no dedicated admin UI in this pass, just the query a future one would call. reasonText is always null by the time a DELETED row reaches here (see delete()); a DEACTIVATED row's reasonText is real until/unless that same candidate later deletes their account. */
  async listActionsForAdmin(limit = 100) {
    return this.prisma.accountAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private async getOwnedProfile(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No candidate profile found for this account.');
    return profile;
  }

  /**
   * Shared by deactivate() and delete() — both make the candidate
   * unavailable to employers the same way; delete() just does it as one
   * step among several irreversible ones instead of the only one.
   */
  private async makeCandidateUnavailableToEmployers(profileId: string): Promise<void> {
    const livePipelines = await this.prisma.shortlistEntry.findMany({
      where: { candidateId: profileId, stage: { in: LIVE_PIPELINE_STAGES } },
      include: { organization: { select: { name: true } }, job: { select: { title: true } } },
    });

    for (const entry of livePipelines) {
      await this.prisma.shortlistEntry.update({
        where: { id: entry.id },
        data: { preUnavailableStage: entry.stage, stage: ShortlistStage.CANDIDATE_UNAVAILABLE },
      });

      const roleLine = entry.job ? ` for ${entry.job.title}` : '';
      // Deliberately never includes the candidate's stated reason (job
      // found elsewhere, too many emails, privacy concerns, ...) — that's
      // between the candidate and SkillProof, not something an employer is
      // owed an explanation for. "No longer available" is true and
      // complete without it.
      await this.notifications.sendEmail(
        entry.addedByUserId,
        NotificationType.PIPELINE_CANDIDATE_UNAVAILABLE,
        `A candidate${roleLine} is no longer available`,
        renderNotificationEmail(
          `<p>A candidate you were in an active pipeline with${roleLine} is no longer available on SkillProof.</p>`,
          { label: 'View your shortlist', url: `${WEB_BASE_URL}/employer/shortlist` },
        ),
      );
    }

    await this.prisma.application.updateMany({
      where: { candidateProfileId: profileId, status: { in: [...PENDING_APPLICATION_STATUSES] } },
      data: { status: 'WITHDRAWN' },
    });
  }

  /** Best-effort, same convention as ProfilesService/CertificationsService's own file cleanup — a file already missing on disk must never block the rest of deletion. */
  private async deleteStoredFiles(profileId: string, photoKey: string | null, resumeS3Key: string | null): Promise<void> {
    const certFiles = await this.prisma.certification.findMany({
      where: { profileId, fileUrl: { not: null } },
      select: { fileUrl: true },
    });
    const filenames = [photoKey, resumeS3Key, ...certFiles.map((c) => c.fileUrl)].filter(
      (f): f is string => f != null,
    );
    await Promise.all(
      filenames.map((filename) =>
        fs.unlink(join(UPLOAD_DIR, filename)).catch(() => undefined),
      ),
    );
  }
}
