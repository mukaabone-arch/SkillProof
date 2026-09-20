import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountActionType, ClaimStatus, IntegrityStatus, NotificationType, OrgVerificationStatus, Prisma, ReviewOutcome, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { renderNotificationEmail } from '../notifications/notification-email.template';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { notifyOrgMembers } from '../orgs/notify-org-members';
import { isCandidateVerified, missingVerificationFields } from '../auth/candidate-verification-readiness';
import {
  BulkQuestionItemDto,
  CreateAssessmentDto,
  CreateQuestionDto,
  DecideOrgVerificationDto,
  LiftAssessmentBlockDto,
  ListAttemptsQueryDto,
  ListCandidatesQueryDto,
  ListOrgsQueryDto,
  ReviewAttemptDto,
  SetSubscriptionDto,
  UpdateAssessmentDto,
} from './admin.dto';

interface BulkItemErrors {
  index: number;
  errors: string[];
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Manual tier assignment — foundation work for testing entitlements
   * before any payment provider exists (see EntitlementsService's own
   * module doc comment). `candidateProfileId` is CandidateProfile.id, the
   * same id every other employer/admin-facing surface keys candidates by.
   */
  setSubscription(candidateProfileId: string, dto: SetSubscriptionDto) {
    return this.entitlements.setTierManually(
      candidateProfileId,
      dto.tier,
      dto.status ?? SubscriptionStatus.ACTIVE,
      dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null,
      dto.cancelAtPeriodEnd ?? false,
    );
  }

  listAssessments() {
    return this.prisma.assessment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        skill: { include: { domain: true } },
        _count: { select: { questions: { where: { isLive: true } } } },
      },
    });
  }

  createAssessment(dto: CreateAssessmentDto) {
    return this.prisma.assessment.create({ data: dto });
  }

  async updateAssessment(id: string, dto: UpdateAssessmentDto) {
    await this.getAssessmentOrThrow(id);
    return this.prisma.assessment.update({ where: { id }, data: dto });
  }

  async addQuestion(assessmentId: string, dto: CreateQuestionDto) {
    await this.getAssessmentOrThrow(assessmentId);
    if (dto.correctIndex >= dto.options.length) {
      throw new BadRequestException('correctIndex must reference one of the provided options');
    }

    return this.prisma.question.create({
      data: this.buildQuestionData(assessmentId, dto.text, dto.options, dto.correctIndex, dto.difficulty),
    });
  }

  /**
   * Validates the entire batch before writing anything — a bad item anywhere
   * in the paste fails the whole import with a per-item report instead of
   * half-importing. Rows are created via the exact same data shape as
   * `addQuestion` (buildQuestionData), so bulk and single-question imports
   * are indistinguishable in the DB.
   */
  async bulkAddQuestions(assessmentId: string, body: unknown) {
    await this.getAssessmentOrThrow(assessmentId);

    if (!Array.isArray(body) || body.length === 0) {
      throw new BadRequestException('Expected a non-empty JSON array of question objects.');
    }

    const errorReport: BulkItemErrors[] = [];
    const valid: BulkQuestionItemDto[] = [];

    for (let index = 0; index < body.length; index++) {
      const raw = body[index];
      if (typeof raw !== 'object' || raw === null) {
        errorReport.push({ index, errors: ['Expected a JSON object'] });
        continue;
      }

      const dto = plainToInstance(BulkQuestionItemDto, raw);
      const violations = await validate(dto);
      const messages = violations.flatMap((v) => Object.values(v.constraints ?? {}));

      if (Array.isArray(dto.options) && Number.isInteger(dto.correctIndex) && dto.correctIndex >= dto.options.length) {
        messages.push('correctIndex must reference one of the provided options');
      }

      if (messages.length > 0) {
        errorReport.push({ index, errors: messages });
      } else {
        valid.push(dto);
      }
    }

    if (errorReport.length > 0) {
      throw new BadRequestException({
        message: `${errorReport.length} of ${body.length} question(s) failed validation — nothing was imported.`,
        errors: errorReport,
      });
    }

    const created = await this.prisma.$transaction(
      valid.map((dto) =>
        this.prisma.question.create({
          data: this.buildQuestionData(assessmentId, dto.question, dto.options, dto.correctIndex, dto.difficulty ?? 2),
        }),
      ),
    );

    return { created: created.length };
  }

  /** Single source of truth for the Question row shape — reused by addQuestion and bulkAddQuestions. */
  private buildQuestionData(
    assessmentId: string,
    text: string,
    options: string[],
    correctIndex: number,
    difficulty: number,
  ): Prisma.QuestionCreateInput {
    return {
      assessment: { connect: { id: assessmentId } },
      type: 'MCQ',
      body: { text, options },
      correct: { answer: correctIndex },
      difficulty,
      isLive: true,
    };
  }

  async removeQuestion(id: string) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) throw new NotFoundException('Question not found');
    return this.prisma.question.update({ where: { id }, data: { isLive: false } });
  }

  /**
   * Admin-only attempt detail, including integrity signals — the candidate's
   * own GET /attempts/:id/result never includes any of this. Events are
   * summarized by type/count plus the full timeline; flags/events, not a
   * verdict — admins interpret them, the system doesn't auto-fail attempts.
   */
  async getAttemptForReview(id: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, phone: true, email: true, profile: { select: { fullName: true } } } },
        assessment: { select: { title: true, skill: { select: { name: true } } } },
        integrityEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    const eventCountsByType: Record<string, number> = {};
    for (const e of attempt.integrityEvents) {
      eventCountsByType[e.type] = (eventCountsByType[e.type] ?? 0) + 1;
    }

    return {
      id: attempt.id,
      status: attempt.status,
      scorePercent: attempt.scorePercent,
      passed: attempt.passed,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      candidate: {
        id: attempt.user.id,
        fullName: attempt.user.profile?.fullName ?? null,
        phone: attempt.user.phone,
        email: attempt.user.email,
      },
      assessmentTitle: attempt.assessment.title,
      skillName: attempt.assessment.skill.name,
      integrity: {
        status: attempt.integrityStatus,
        flagCount: attempt.integrityFlagCount,
        eventCountsByType,
        events: attempt.integrityEvents.map((e) => ({
          type: e.type,
          metadata: e.metadata,
          createdAt: e.createdAt,
        })),
      },
    };
  }

  /** Lightweight list for the review queue — GET /admin/attempts?status=FLAGGED. */
  async listAttemptsForReview(query: ListAttemptsQueryDto) {
    const attempts = await this.prisma.attempt.findMany({
      where: query.status ? { integrityStatus: query.status } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { id: true, phone: true, email: true, profile: { select: { fullName: true } } } },
        assessment: { select: { title: true, skill: { select: { name: true } } } },
      },
    });

    return attempts.map((a) => ({
      id: a.id,
      status: a.status,
      scorePercent: a.scorePercent,
      passed: a.passed,
      candidate: {
        id: a.user.id,
        fullName: a.user.profile?.fullName ?? null,
        phone: a.user.phone,
        email: a.user.email,
      },
      assessmentTitle: a.assessment.title,
      skillName: a.assessment.skill.name,
      integrityStatus: a.integrityStatus,
      integrityFlagCount: a.integrityFlagCount,
      reviewOutcome: a.reviewOutcome,
      reviewedAt: a.reviewedAt,
    }));
  }

  /**
   * The only path that can invalidate an attempt/badge — never automatic.
   * APPROVED clears the flag back to CLEAN (the candidate is never
   * permanently penalized in the UI for something an admin reviewed and
   * cleared — the certificate's "Verified clean" mark reappears). INVALIDATED
   * revokes the badge (so the public certificate 404s outright) and expires
   * the resulting skill claim, so an invalidated result stops conferring
   * "verified" anywhere else in the app (search, matching, etc.).
   */
  async reviewAttempt(attemptId: string, adminUserId: string, dto: ReviewAttemptDto) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { badge: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    const newStatus = dto.outcome === ReviewOutcome.APPROVED ? IntegrityStatus.CLEAN : IntegrityStatus.INVALIDATED;

    const updated = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        integrityStatus: newStatus,
        reviewOutcome: dto.outcome,
        reviewNote: dto.note,
        reviewedAt: new Date(),
        reviewedByUserId: adminUserId,
        ...(dto.outcome === ReviewOutcome.INVALIDATED ? { passed: false } : {}),
      },
    });

    if (dto.outcome === ReviewOutcome.INVALIDATED && attempt.badge) {
      await this.prisma.badge.update({
        where: { id: attempt.badge.id },
        data: { revokedAt: new Date() },
      });
      await this.prisma.skillClaim.updateMany({
        where: { badgeId: attempt.badge.id },
        data: { status: ClaimStatus.EXPIRED },
      });
    }

    return updated;
  }

  private async getAssessmentOrThrow(id: string) {
    const assessment = await this.prisma.assessment.findUnique({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }

  // ---------- Org verification ----------

  /** Review queue — GET /admin/orgs?verificationStatus=PENDING lists orgs awaiting a decision; omitted, every org. */
  listOrgs(query: ListOrgsQueryDto) {
    return this.prisma.organization.findMany({
      where: query.verificationStatus ? { verificationStatus: query.verificationStatus } : undefined,
      orderBy: { verificationSubmittedAt: 'asc' },
      include: {
        verificationSubmittedByUser: { select: { id: true, email: true, phone: true } },
        deactivatedByUser: { select: { id: true, email: true, phone: true } },
      },
    });
  }

  /**
   * The only way a PENDING verification request resolves — see
   * OrgVerificationStatus for the state machine this enforces (only a
   * PENDING row can be decided; VERIFIED/UNVERIFIED/another REJECTED
   * aren't valid starting points). Notifies
   * Organization.verificationSubmittedByUser only — never every org
   * member, see that notification type's own doc comment in
   * schema.prisma — and only if that user still exists on the row (it's a
   * nullable FK, ON DELETE SET NULL).
   */
  async decideOrgVerification(orgId: string, adminUserId: string, dto: DecideOrgVerificationDto) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.verificationStatus !== OrgVerificationStatus.PENDING) {
      throw new BadRequestException('Only a pending verification request can be decided.');
    }
    if (dto.status === OrgVerificationStatus.REJECTED && !dto.rejectionReason?.trim()) {
      throw new BadRequestException('rejectionReason is required when rejecting.');
    }

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        verificationStatus: dto.status,
        verifiedAt: new Date(),
        verifiedByUserId: adminUserId,
        rejectionReason: dto.status === OrgVerificationStatus.REJECTED ? dto.rejectionReason!.trim() : null,
      },
    });

    if (org.verificationSubmittedByUserId) {
      await this.notifyOrgVerificationDecision(
        org.verificationSubmittedByUserId,
        org.name,
        updated.verificationStatus,
        updated.rejectionReason,
      );
    }

    return updated;
  }

  private async notifyOrgVerificationDecision(
    userId: string,
    orgName: string,
    status: OrgVerificationStatus,
    rejectionReason: string | null,
  ): Promise<void> {
    const approved = status === OrgVerificationStatus.VERIFIED;
    const subject = approved ? 'Your organization is now verified' : 'Your organization verification was not approved';
    const bodyHtml = approved
      ? `<p><strong>${escapeHtml(orgName)}</strong> has been verified. Your team now has full access to the employer portal — Job Postings, Find Candidates, Applicants, Shortlist, and Billing — and the verified badge is visible to candidates.</p>`
      : `<p><strong>${escapeHtml(orgName)}</strong>'s verification request was not approved.</p>` +
        `<p>Reason: ${escapeHtml(rejectionReason ?? '')}</p>` +
        `<p>You can update your organization details and resubmit at any time.</p>`;
    const html = renderNotificationEmail(
      bodyHtml,
      approved
        ? { label: 'Go to employer portal', url: `${WEB_BASE_URL}/employer/dashboard` }
        : { label: 'View organization settings', url: `${WEB_BASE_URL}/employer/settings` },
    );
    await this.notifications.sendEmail(
      userId,
      approved ? NotificationType.ORG_VERIFICATION_APPROVED : NotificationType.ORG_VERIFICATION_REJECTED,
      subject,
      html,
    );
  }

  /**
   * The only way an org's OrgActiveGuard block is lifted — no self-service
   * path exists (see Organization.deactivatedAt's own doc comment).
   * Logged via AdminAccessLog rather than a second attribution column on
   * Organization, matching that model's own doc comment on why an
   * org-scoped platform-admin action belongs there. Deliberately does NOT
   * reopen any job OrgsService.deactivate closed — applicants were
   * already told those roles are no longer accepting applications, and
   * re-opening one is a separate, deliberate employer action once they're
   * back in, not an automatic side effect of this.
   */
  // ---------- Candidate Management ----------

  /**
   * GET /admin/candidates — list view only (2026-09); payment details,
   * access-control and assessment-issue panels are deliberately out of
   * scope for this slice, but every row links to /admin/candidates/:id so
   * those can land on a detail page later without retrofitting navigation.
   *
   * Every signed-up candidate, at every verification stage, including
   * incomplete (DECIDE 2) — someone who never verified a phone is exactly
   * who this list exists to surface, not someone to filter out by default.
   * `verified`/`missingVerification` are derived the same way
   * CandidateVerificationGuard itself does (isCandidateVerified /
   * missingVerificationFields — presence-implies-verified, see that
   * file's own doc comment), not a second, parallel check that could drift.
   *
   * `lastActivityAt` (DECIDE 1a) is derived, not tracked: the max of
   * Attempt.createdAt, AttemptAnswer.createdAt and Badge.issuedAt (Badge
   * has no createdAt of its own — issuedAt is its creation timestamp) for
   * that candidate, computed here rather than stored — works retroactively
   * for every existing candidate, at the cost of never reflecting a visit
   * where nothing was attempted. Named for exactly what it measures — see
   * this DTO's own field, and the frontend's "—" rendering for null,
   * never a fallback to signup date (a candidate who never attempted
   * anything must never read as "last active on signup day").
   *
   * `lastLoginAt` sits beside it, not instead of it — a genuinely tracked
   * column (User.lastLoginAt, written by AuthService.issueTokens), answering
   * a different question ("when did they last authenticate" vs. "when did
   * they last do something"). Null for anyone who hasn't signed in since
   * this shipped — same "—", never signup-date, rendering rule as
   * lastActivityAt, and for the same reason.
   *
   * `accountState` ('ACTIVE' | 'DEACTIVATED' | 'DELETED') exists because a
   * deleted candidate is otherwise indistinguishable from a broken signup:
   * AccountService.delete anonymises phone/email/Identity in place — there
   * is no `deletedAt` on User — so a deleted row would render as a raw-ID
   * name, "Missing phone, email", and authMethod "Unknown", which reads as
   * corrupt data rather than working-as-intended anonymisation. Checked in
   * this priority order deliberately: DELETED first, then deactivatedAt,
   * because a deleted profile can still carry a deactivatedAt from an
   * earlier deactivation and DELETED is the stronger, terminal statement.
   * Deactivation is NOT tested via "has a DEACTIVATED AccountAction row" —
   * that row survives a later reactivation (a REACTIVATED row gets added
   * alongside it, neither is ever removed), so that test would wrongly
   * mark a reactivated candidate as deactivated forever.
   * CandidateProfile.deactivatedAt is the only correct, current-state test.
   * Deletion has no reversal path, so "a DELETED AccountAction exists" is
   * safe to test directly. Deleted accounts stay in the default listing,
   * marked rather than hidden — same "don't filter out by default"
   * reasoning as the verification-stage note above; an admin looking for a
   * candidate who no longer appears needs to be able to find them.
   *
   * `authMethod` is derived from Identity rows, not guessed from which of
   * phone/email happen to be set (those can both end up populated
   * regardless of how the account started, via /auth/link/*). Identity
   * rows are only ever written by OAuth login (loginWithIdentity) —
   * IdentityProvider.PHONE is declared in the enum but never used anywhere
   * in this codebase, so "no Identity row" reliably means "phone or email
   * OTP," never "phone OTP specifically" without also checking which of
   * the two is actually set.
   *
   * One raw $queryRaw for the page (search + the three-way lastActivityAt
   * max + counts + block flag in a single query, avoiding an N+1 across
   * the page's rows) plus one cheap COUNT(*) for the total — see this
   * method's own doc comment on why a plain Prisma query was awkward here.
   * Tagged template throughout, exactly like entitlements.service.ts's own
   * $queryRaw usage — `search` is always a parameterized value, never
   * concatenated; the only interpolated *fragment* (sort column/direction)
   * comes from an already class-validator-@IsEnum-checked DTO field, never
   * from the raw query string.
   */
  async listCandidates(adminUserId: string, dto: ListCandidatesQueryDto) {
    const offset = (dto.page - 1) * dto.pageSize;
    const searchTerm = dto.search?.trim();
    const searchPattern = searchTerm ? `%${escapeLikePattern(searchTerm)}%` : null;

    const searchClause = searchPattern
      ? Prisma.sql`AND (u.email ILIKE ${searchPattern} ESCAPE '\' OR u.phone ILIKE ${searchPattern} ESCAPE '\' OR cp."fullName" ILIKE ${searchPattern} ESCAPE '\')`
      : Prisma.empty;

    const orderClause =
      dto.sort === 'lastActivityAt'
        ? Prisma.sql`"lastActivityAt" ${dto.order === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC')} NULLS LAST`
        : Prisma.sql`u."createdAt" ${dto.order === 'asc' ? Prisma.raw('ASC') : Prisma.raw('DESC')}`;

    const [rows, totalRows] = await Promise.all([
      this.prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT
          u.id AS "userId",
          u.phone,
          u.email,
          u."createdAt",
          u."lastLoginAt",
          cp."fullName",
          (
            SELECT MAX(t."at") FROM (
              SELECT "createdAt" AS "at" FROM "Attempt" WHERE "userId" = u.id
              UNION ALL
              SELECT aa."createdAt" AS "at" FROM "AttemptAnswer" aa JOIN "Attempt" a ON a.id = aa."attemptId" WHERE a."userId" = u.id
              UNION ALL
              SELECT "issuedAt" AS "at" FROM "Badge" WHERE "userId" = u.id
            ) t
          ) AS "lastActivityAt",
          (SELECT COUNT(*)::int FROM "Attempt" WHERE "userId" = u.id) AS "attemptCount",
          (SELECT COUNT(*)::int FROM "Badge" WHERE "userId" = u.id) AS "badgeCount",
          EXISTS (
            SELECT 1 FROM "AssessmentBlock" ab WHERE ab."userId" = u.id AND ab."liftedAt" IS NULL AND ab."expiresAt" > now()
          ) AS "blocked",
          COALESCE(
            (SELECT array_agg(DISTINCT i.provider) FROM "Identity" i WHERE i."userId" = u.id),
            ARRAY[]::"IdentityProvider"[]
          ) AS "identityProviders",
          CASE
            WHEN EXISTS (
              SELECT 1 FROM "AccountAction" aa
              WHERE aa."candidateProfileId" = cp.id AND aa.type = ${AccountActionType.DELETED}::"AccountActionType"
            ) THEN 'DELETED'
            WHEN cp."deactivatedAt" IS NOT NULL THEN 'DEACTIVATED'
            ELSE 'ACTIVE'
          END AS "accountState"
        FROM "User" u
        LEFT JOIN "CandidateProfile" cp ON cp."userId" = u.id
        WHERE u.role = 'CANDIDATE'
        ${searchClause}
        ORDER BY ${orderClause}
        LIMIT ${dto.pageSize} OFFSET ${offset}
      `),
      this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS count
        FROM "User" u
        LEFT JOIN "CandidateProfile" cp ON cp."userId" = u.id
        WHERE u.role = 'CANDIDATE'
        ${searchClause}
      `),
    ]);

    try {
      await this.prisma.adminAccessLog.create({
        data: {
          adminUserId,
          action: 'CANDIDATE_LIST_VIEWED',
          targetType: 'CandidateList',
          targetId: searchTerm ? `search:${searchTerm}` : `page:${dto.page}`,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write AdminAccessLog for CANDIDATE_LIST_VIEWED: ${(err as Error).message}`);
    }

    return {
      total: Number(totalRows[0]?.count ?? 0),
      page: dto.page,
      pageSize: dto.pageSize,
      candidates: rows.map((r) => {
        const missing = missingVerificationFields({ phone: r.phone, email: r.email });
        return {
          id: r.userId,
          name: r.fullName,
          email: r.email,
          phone: r.phone,
          createdAt: r.createdAt,
          verified: isCandidateVerified({ phone: r.phone, email: r.email }),
          missingVerification: missing,
          authMethod: resolveAuthMethod(r.identityProviders, r.phone, r.email),
          lastLoginAt: r.lastLoginAt,
          lastActivityAt: r.lastActivityAt,
          attemptCount: r.attemptCount,
          badgeCount: r.badgeCount,
          blocked: r.blocked,
          accountState: r.accountState,
        };
      }),
    };
  }

  /**
   * All AssessmentBlock rows, most recent first — the audit history is
   * never deleted (see that model's own doc comment), so this always
   * includes lifted and expired blocks too, not just currently-active
   * ones, which is what lets an admin see both the raw counts (how many
   * ever raised) and how many were lifted on appeal. No pagination, same
   * convention as listAttemptsForReview/listOrgs.
   */
  async listAssessmentBlocks() {
    const blocks = await this.prisma.assessmentBlock.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, phone: true, email: true, profile: { select: { fullName: true } } } },
        skill: { select: { name: true } },
        liftedByUser: { select: { id: true, email: true, phone: true } },
      },
    });

    const attemptIds = [...new Set(blocks.flatMap((b) => b.triggerAttemptIds))];
    const attempts = attemptIds.length
      ? await this.prisma.attempt.findMany({
          where: { id: { in: attemptIds } },
          select: { id: true, createdAt: true, integrityFlagCount: true, assessment: { select: { title: true } } },
        })
      : [];
    const attemptsById = new Map(attempts.map((a) => [a.id, a]));

    return {
      summary: {
        totalRaised: blocks.length,
        totalLifted: blocks.filter((b) => b.liftedAt).length,
        currentlyActive: blocks.filter((b) => !b.liftedAt && b.expiresAt > new Date()).length,
      },
      blocks: blocks.map((b) => ({
        ...b,
        triggerAttempts: b.triggerAttemptIds.map((id) => attemptsById.get(id) ?? null),
      })),
    };
  }

  /**
   * The only way an AssessmentBlock's bar is lifted early — same
   * "set/null the pair, never delete the row" convention as
   * Organization.deactivatedAt/deactivatedByUserId below (reactivateOrg).
   * Unlike reactivateOrg this doesn't null the "raised" side back out —
   * startedAt/reason/triggerAttemptIds are permanent history; only
   * liftedAt/liftedByUserId/liftedNote are ever written after creation.
   */
  async liftAssessmentBlock(blockId: string, adminUserId: string, dto: LiftAssessmentBlockDto) {
    const block = await this.prisma.assessmentBlock.findUnique({ where: { id: blockId } });
    if (!block) throw new NotFoundException('Assessment block not found');
    if (block.liftedAt) throw new BadRequestException('This block has already been lifted.');

    const updated = await this.prisma.assessmentBlock.update({
      where: { id: blockId },
      data: { liftedAt: new Date(), liftedByUserId: adminUserId, liftedNote: dto.note ?? null },
    });

    try {
      await this.prisma.adminAccessLog.create({
        data: { adminUserId, action: 'ASSESSMENT_BLOCK_LIFTED', targetType: 'AssessmentBlock', targetId: blockId },
      });
    } catch (err) {
      this.logger.error(`Failed to write AdminAccessLog for ASSESSMENT_BLOCK_LIFTED: ${(err as Error).message}`);
    }

    return updated;
  }

  async reactivateOrg(orgId: string, adminUserId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.deactivatedAt) throw new BadRequestException('This organization is not deactivated.');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { deactivatedAt: null, deactivatedByUserId: null },
    });

    await this.logAdminAccess(adminUserId, 'ORG_REACTIVATED', orgId);

    await notifyOrgMembers(
      this.prisma,
      this.notifications,
      orgId,
      NotificationType.ORG_REACTIVATED,
      'Your organization has been reactivated on MyAmbii',
      renderNotificationEmail(
        `<p><strong>${escapeHtml(org.name)}</strong> has been reactivated. Every team member can sign back in to ` +
          `the employer portal.</p>` +
          `<p>Any job that was unpublished when the organization was deactivated stays closed — re-post it ` +
          `manually if you'd like applications to reopen for it.</p>`,
        { label: 'Go to employer portal', url: `${WEB_BASE_URL}/employer/dashboard` },
      ),
    );

    return updated;
  }

  /** Same best-effort, logged-not-thrown contract as BillingProfilesService's own logAdminAccess. */
  private async logAdminAccess(adminUserId: string, action: string, organizationId: string): Promise<void> {
    try {
      await this.prisma.adminAccessLog.create({
        data: { adminUserId, action, targetType: 'Organization', targetId: organizationId, organizationId },
      });
    } catch (err) {
      this.logger.error(`Failed to write AdminAccessLog for ${action}: ${(err as Error).message}`);
    }
  }
}

/** Employer-authored free text (org name, rejection reason) landing in an HTML email body — same local escape as JobsService's own, not shared, since neither module exports one today. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** listCandidates' raw query row shape — snake-free, matches the SQL's own column aliases exactly. */
interface CandidateRow {
  userId: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  fullName: string | null;
  lastActivityAt: Date | null;
  attemptCount: number;
  badgeCount: number;
  blocked: boolean;
  identityProviders: string[];
  accountState: 'ACTIVE' | 'DEACTIVATED' | 'DELETED';
}

/** Escapes ILIKE's own wildcard characters (and the escape character itself) in a user-supplied search term, so a literal "%" or "_" in a search box searches for that literal character rather than being treated as a wildcard. Paired with `ESCAPE '\'` in the query. Unrelated to SQL-injection safety, which the tagged template already guarantees on its own. */
function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * See listCandidates' own doc comment on why this reads Identity rows
 * rather than guessing from phone/email presence. GOOGLE/GITHUB take
 * priority over phone/email OTP even if the candidate later linked a
 * phone or email to that OAuth account — this reports how the account
 * itself authenticates, not merely which identifiers happen to exist.
 */
function resolveAuthMethod(identityProviders: string[], phone: string | null, email: string | null): string {
  if (identityProviders.includes('GOOGLE')) return 'Google';
  if (identityProviders.includes('GITHUB')) return 'GitHub';
  if (phone) return 'Phone OTP';
  if (email) return 'Email OTP';
  return 'Unknown';
}
