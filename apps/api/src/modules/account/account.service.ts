import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountActionType,
  AssessmentRequestStatus,
  NotificationStatus,
  NotificationType,
  Prisma,
  ShortlistStage,
} from '@prisma/client';
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

  /**
   * Compliance Center / Privacy Requests — a record-and-audit view over
   * account actions that already executed, never an approval gate (see
   * the Compliance Center's own framing: erasure is a legal right, not
   * something granted here). reasonText is deliberately never returned —
   * unlike reasonCategory (a closed enum, never identifying on its own),
   * reasonText is candidate-authored free text that could contain
   * anything, including on a still-active DEACTIVATED row that hasn't
   * been scrubbed by a later deletion yet. A page whose whole purpose is
   * demonstrating erasure must not be the one place that free text still
   * surfaces.
   *
   * Two signals are correlated in from elsewhere, both deliberately
   * *not* claimed as caused-by-this-action — the code has no FK or
   * transactional link that would make that claim honest (see the
   * Compliance Center audit this was built from):
   *
   *  - confirmationEmailStatus: the ACCOUNT_DEACTIVATED/ACCOUNT_DELETED
   *    Notification this exact action sent. This one *is* safely
   *    attributable despite no FK existing: deactivate()/delete() each
   *    send exactly one such email, unconditionally, in strict
   *    chronological lockstep with creating the AccountAction row — so
   *    the Nth-oldest DEACTIVATED action for a user always pairs with the
   *    Nth-oldest ACCOUNT_DEACTIVATED notification for that user, via
   *    ascending-createdAt zip, not a fragile time-window guess. Null for
   *    REACTIVATED — reactivate() sends no email at all.
   *  - pipelinesUnavailable / candidateHasFailedRefund: live current
   *    state (this candidate's ShortlistEntry rows still sitting in
   *    CANDIDATE_UNAVAILABLE right now, and whether they have an
   *    AssessmentRequest stuck at REFUND_FAILED right now), attached only
   *    to a candidate's most recent DEACTIVATED/DELETED action *if* no
   *    later REACTIVATED action has superseded it. There is no per-
   *    pipeline or per-notification historical count anywhere in this
   *    schema (see makeCandidateUnavailableToEmployers — it's a live
   *    WHERE filter and a fire-and-forget email loop, not an audit
   *    table), and refunds are not actually wired to fire from deletion
   *    at all today (delete()'s own comment calls that an unwired seam) —
   *    so this can only ever describe the candidate's current standing,
   *    not what this specific action historically caused.
   */
  async listActionsForAdmin(query: {
    type?: AccountActionType;
    from?: string;
    to?: string;
    status?: 'ALL' | 'NEEDS_ATTENTION' | 'CLEAN';
  } = {}) {
    // Unfiltered on purpose — see confirmationEmailStatus's doc comment
    // above: correct pairing needs every action for a user, in order,
    // regardless of which slice the caller asked to see. Filters apply
    // only to the final, already-computed rows below.
    const actions = await this.prisma.accountAction.findMany({
      orderBy: { createdAt: 'asc' },
      include: { candidateProfile: { select: { id: true, userId: true, deletedAt: true, deactivatedAt: true } } },
    });

    const candidateProfileIds = [...new Set(actions.map((a) => a.candidateProfileId))];
    const userIds = [...new Set(actions.map((a) => a.candidateProfile.userId))];

    const [pipelineCounts, refundFailedRows, confirmationEmails] = await Promise.all([
      this.prisma.shortlistEntry.groupBy({
        by: ['candidateId'],
        where: { candidateId: { in: candidateProfileIds }, stage: ShortlistStage.CANDIDATE_UNAVAILABLE },
        _count: { _all: true },
      }),
      this.prisma.assessmentRequest.findMany({
        where: { candidateId: { in: candidateProfileIds }, status: AssessmentRequestStatus.REFUND_FAILED },
        select: { candidateId: true },
        distinct: ['candidateId'],
      }),
      this.prisma.notification.findMany({
        where: {
          userId: { in: userIds },
          type: { in: [NotificationType.ACCOUNT_DEACTIVATED, NotificationType.ACCOUNT_DELETED] },
        },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, type: true, status: true },
      }),
    ]);

    const pipelinesByCandidateId = new Map(pipelineCounts.map((p) => [p.candidateId, p._count._all]));
    const refundFailedCandidateIds = new Set(refundFailedRows.map((r) => r.candidateId));

    // FIFO queues per (userId, notification type) — shift() below consumes
    // them in the same ascending-createdAt order `actions` is already in,
    // which is what makes the zip-pairing correct (see this method's own
    // doc comment).
    const confirmationQueues = new Map<string, NotificationStatus[]>();
    for (const n of confirmationEmails) {
      const key = `${n.userId}:${n.type}`;
      const queue = confirmationQueues.get(key) ?? [];
      queue.push(n.status);
      confirmationQueues.set(key, queue);
    }

    // Latest action per candidate — the one "currently in effect" row live
    // state attaches to (see doc comment above).
    const latestActionIdByCandidateId = new Map<string, string>();
    for (const a of actions) latestActionIdByCandidateId.set(a.candidateProfileId, a.id); // ascending order — last write wins, i.e. the true latest

    const rows = actions.map((a) => {
      const confirmationEmailType =
        a.type === AccountActionType.DEACTIVATED
          ? NotificationType.ACCOUNT_DEACTIVATED
          : a.type === AccountActionType.DELETED
            ? NotificationType.ACCOUNT_DELETED
            : null;
      let confirmationEmailStatus: NotificationStatus | null = null;
      if (confirmationEmailType) {
        const key = `${a.candidateProfile.userId}:${confirmationEmailType}`;
        confirmationEmailStatus = confirmationQueues.get(key)?.shift() ?? null;
      }

      const isCurrentUnavailabilityAction =
        a.type !== AccountActionType.REACTIVATED &&
        latestActionIdByCandidateId.get(a.candidateProfileId) === a.id;
      const pipelinesUnavailable = isCurrentUnavailabilityAction
        ? pipelinesByCandidateId.get(a.candidateProfileId) ?? 0
        : null;
      const candidateHasFailedRefund = isCurrentUnavailabilityAction && refundFailedCandidateIds.has(a.candidateProfileId);

      const needsAttention = confirmationEmailStatus === NotificationStatus.FAILED || candidateHasFailedRefund;

      return {
        id: a.id,
        type: a.type,
        reasonCategory: a.reasonCategory,
        createdAt: a.createdAt,
        // Short, stable, never-identifying reference — same convention as
        // the session-review queue's "Case {id.slice(0,8)}" (never the
        // candidate's name), since a name is exactly what a DELETED row
        // no longer has to show.
        candidateRef: a.candidateProfileId.slice(0, 8),
        candidateCurrentlyDeactivated: a.candidateProfile.deactivatedAt !== null,
        candidateCurrentlyDeleted: a.candidateProfile.deletedAt !== null,
        confirmationEmailStatus,
        pipelinesUnavailable,
        candidateHasFailedRefund,
        needsAttention,
      };
    });

    const filtered = rows.filter((r) => {
      if (query.type && r.type !== query.type) return false;
      if (query.from && r.createdAt < new Date(query.from)) return false;
      if (query.to && r.createdAt > new Date(query.to)) return false;
      if (query.status === 'NEEDS_ATTENTION' && !r.needsAttention) return false;
      if (query.status === 'CLEAN' && r.needsAttention) return false;
      return true;
    });

    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return filtered;
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
