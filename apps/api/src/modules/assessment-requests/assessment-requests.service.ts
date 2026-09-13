import { BadRequestException, ForbiddenException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssessmentRequestStatus, AssessmentSessionStatus, AttemptStatus, NotificationType, SkillLevel, TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssessmentsService } from '../assessments/assessments.service';
import { TopicBreakdown } from '../assessments/topic-breakdown';
import { AssessmentSessionsService } from '../assessment-sessions/assessment-sessions.service';
import { BadgeResolverService } from '../badges/badge-resolver.service';
import { DISCUSSION_DURATION_MINS, SKILL_LEVEL as DISCUSSION_LEVEL, SKILL_NAME as DISCUSSION_SKILL_NAME } from '../assessment-sessions/rag-systems-l2.rubric';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { TransactionsService } from '../billing/transactions.service';
import { AssessmentRequestBillingProfileService } from './assessment-request-billing-profile.service';
import { splitGst, DEFAULT_PLACE_OF_SUPPLY_STATE_CODE } from '../../config/gst.config';

/**
 * Paise, GST-EXCLUSIVE. Still used two ways after the 2026-09-14
 * outcome-priced rework: (1) unchanged, for any legacy (level != null)
 * request — none can be created anymore, but old rows already accrued at
 * this rate; (2) the whole-skill "started but not all levels attempted"
 * tier, unrelated to (1) other than sharing the same rupee amount by
 * coincidence. Env override name predates the rework and still names just
 * this one amount, not the (also-configurable) complete-tier amount below.
 */
const DEFAULT_BASE_AMOUNT_PAISE = 15000; // ₹150
/** The whole-skill "all levels attempted" tier — independent constant, independently overridable, on purpose (see this class's own doc comment on why these two never share a knob). */
const COMPLETE_DEFAULT_BASE_AMOUNT_PAISE = 50000; // ₹500
const CURRENCY = 'INR';
const EXPIRY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days — unchanged by the rework: the deadline to start ANYTHING under a request.
/** 14 days from first start — the backstop deadline a whole-skill request settles at if not all levels have been attempted sooner. See AssessmentRequestSettlementJob. */
const SETTLEMENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function baseAmountPaise(): number {
  const fromEnv = process.env.ASSESSMENT_REQUEST_AMOUNT_PAISE;
  const parsed = fromEnv ? Number(fromEnv) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BASE_AMOUNT_PAISE;
}

function completeBaseAmountPaise(): number {
  const fromEnv = process.env.ASSESSMENT_REQUEST_COMPLETE_AMOUNT_PAISE;
  const parsed = fromEnv ? Number(fromEnv) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : COMPLETE_DEFAULT_BASE_AMOUNT_PAISE;
}

type SettlementOutcome = 'PARTIAL' | 'COMPLETE';

/**
 * Employer-triggered candidate assessments — postpaid (2026-09), no
 * payment gateway involved. Two request shapes coexist (2026-09-14,
 * outcome-priced rework — see AssessmentRequest's own schema doc comment):
 *
 * LEGACY (level != null) — one specific skill+level, flat ₹150+GST,
 * charged the instant the request is created. Frozen forever for rows
 * that predate the rework; no new code ever creates one. State machine
 * unchanged from before the rework:
 *   (badge check) --already badged--> ALREADY_BADGED [terminal, never charged]
 *   (badge check) --not badged--> ACCRUED_PENDING_START [Transaction written immediately, PENDING]
 *   ACCRUED_PENDING_START --starts within window--> STARTED [billable]
 *   ACCRUED_PENDING_START --expiresAt passes, never started--> EXPIRED_UNBILLED [Transaction voided]
 *   STARTED --linked attempt/session reaches a terminal decision--> COMPLETED
 *
 * WHOLE-SKILL (level: null) — one whole skill, all three levels created
 * upfront (AssessmentRequestLevel, one per level) and immediately
 * attemptable in any order (employer-triggered attempts already bypass
 * sequential leveling — see BadgeResolverService.assertLevelAvailable's
 * callers — so this doesn't add a restriction). Nothing is charged until
 * settlement, because the amount depends on an outcome not known at
 * creation — see settle() below, and Transaction.amountPaise's own schema
 * doc comment on why this couldn't be done any other way (NOT NULL — no
 * placeholder amount is possible). State machine:
 *   (badge check) --all 3 levels already badged--> ALREADY_BADGED [terminal, never charged]
 *   (badge check) --not all badged--> ACCRUED_PENDING_START [no Transaction yet]
 *   ACCRUED_PENDING_START --any level starts within window--> STARTED [some charge now coming, amount still unknown]
 *   ACCRUED_PENDING_START --expiresAt passes, nothing ever started--> EXPIRED_UNBILLED [₹0, nothing to void — no Transaction ever existed]
 *   STARTED --all 3 levels attempted (checked on every read)--> settle('COMPLETE') --> COMPLETED [₹500+GST]
 *   STARTED --14 days since startedAt pass, not all 3 attempted (AssessmentRequestSettlementJob)--> settle('PARTIAL') --> COMPLETED [₹150+GST]
 *
 * Both shapes share the same monthly invoicing job unmodified: a
 * Transaction only ever exists (either shape) once the request is
 * billable, and that job's own filter (status IN [STARTED, COMPLETED])
 * already covers both — legacy via STARTED (Transaction already exists
 * then), whole-skill via COMPLETED (Transaction never exists before then).
 *
 * The old Razorpay integration (order creation, HMAC-SHA256 signature
 * verification, refund-on-expiry) is gone entirely, not left dormant —
 * see the commit that made this change for the reasoning (zero production
 * rows depended on it, and the subscriptions module's own Razorpay
 * webhook verification remains a working reference if prepaid ever
 * returns).
 */
@Injectable()
export class AssessmentRequestsService {
  private readonly logger = new Logger(AssessmentRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly assessments: AssessmentsService,
    private readonly assessmentSessions: AssessmentSessionsService,
    private readonly badgeResolver: BadgeResolverService,
    private readonly transactions: TransactionsService,
    private readonly billingProfiles: AssessmentRequestBillingProfileService,
  ) {}

  /**
   * The whole employer flow for a whole-skill request, in one call — no
   * `level` parameter (2026-09-14 rework; see this class's own doc
   * comment). Validates the candidate is actually on this org's shortlist
   * (IDOR guard) and that the skill has at least one requestable level,
   * checks all of them against the candidate's existing badges in one
   * resolveLevelMap call, and creates the parent AssessmentRequest
   * (level: null) plus one AssessmentRequestLevel child per offered level
   * — every level immediately attemptable, no charge yet at all. If every
   * offered level is already verified, the whole request short-circuits
   * to ALREADY_BADGED with zero charge (the per-request generalization of
   * the old per-level check) and each child's badgeId is set directly, no
   * attempt needed.
   */
  async create(orgId: string, requestedByUserId: string, candidateId: string, skillId: string) {
    const shortlisted = await this.prisma.shortlistEntry.findFirst({ where: { orgId, candidateId } });
    if (!shortlisted) throw new ForbiddenException('This candidate is not on your shortlist.');

    const candidateProfile = await this.prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    if (!candidateProfile) throw new NotFoundException('Candidate not found');

    const levels = await this.assertRequestableSkill(skillId);

    const existingBadges = await this.badgeResolver.resolveLevelMap(candidateProfile.userId, skillId);
    const allBadged = levels.every((level) => existingBadges[level]);

    if (allBadged) {
      const request = await this.prisma.assessmentRequest.create({
        data: {
          orgId,
          requestedByUserId,
          candidateId,
          skillId,
          status: AssessmentRequestStatus.ALREADY_BADGED,
          levels: {
            create: levels.map((level) => ({ level, badgeId: existingBadges[level]!.id })),
          },
        },
      });
      return { alreadyBadged: true as const, requestId: request.id };
    }

    const createdAt = new Date();
    const request = await this.prisma.assessmentRequest.create({
      data: {
        orgId,
        requestedByUserId,
        candidateId,
        skillId,
        status: AssessmentRequestStatus.ACCRUED_PENDING_START,
        expiresAt: new Date(createdAt.getTime() + EXPIRY_WINDOW_MS),
        levels: {
          create: levels.map((level) => ({ level, badgeId: existingBadges[level]?.id ?? null })),
        },
      },
    });

    await this.notifyCandidateInvited(request.id);
    return { alreadyBadged: false as const, requestId: request.id };
  }

  /**
   * Candidate-facing: start one level of a request. Branches on the
   * request's own shape:
   * - Legacy (level set): `level` must match the request's one level
   *   (defensive — the frontend already only ever offers that one level
   *   for such a row); behavior is otherwise byte-for-byte the original
   *   single-level flow.
   * - Whole-skill (level: null): starts the named child level. The first
   *   start across any of the three levels does the atomic
   *   ACCRUED_PENDING_START -> STARTED claim (same race-closing shape as
   *   legacy, against AssessmentRequestExpiryJob's own conditional
   *   update); later starts of other levels just need the request to
   *   already be STARTED. Refuses once the request is COMPLETED (settled)
   *   or EXPIRED_UNBILLED — a request's flow closes when its billing does.
   */
  async startFromRequest(requestId: string, level: SkillLevel, userId: string) {
    const request = await this.getOwnedByCandidate(requestId, userId);

    if (request.level !== null) {
      if (level !== request.level) {
        throw new BadRequestException('This request is for a different level.');
      }
      return this.startLegacyRequest(request, userId);
    }

    return this.startWholeSkillLevel(request, level, userId);
  }

  private async startLegacyRequest(
    request: { id: string; skillId: string; level: SkillLevel | null; attemptId: string | null; sessionId: string | null; status: AssessmentRequestStatus },
    userId: string,
  ) {
    const { count } = await this.prisma.assessmentRequest.updateMany({
      where: { id: request.id, status: AssessmentRequestStatus.ACCRUED_PENDING_START, expiresAt: { gt: new Date() } },
      data: { status: AssessmentRequestStatus.STARTED, startedAt: new Date() },
    });

    const current = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: request.id } });
    if (count === 0 && current.status !== AssessmentRequestStatus.STARTED) {
      throw new ConflictException('This invitation has expired.');
    }

    if (current.attemptId) {
      const attempt = await this.prisma.attempt.findUniqueOrThrow({ where: { id: current.attemptId } });
      return { attemptId: current.attemptId, sessionId: null, assessmentId: attempt.assessmentId };
    }
    if (current.sessionId) {
      return { attemptId: null, sessionId: current.sessionId, assessmentId: null };
    }

    const launched = await this.launchLinkedAssessment(current.skillId, current.level!, userId);
    await this.prisma.assessmentRequest.update({
      where: { id: current.id },
      data: launched.attemptId ? { attemptId: launched.attemptId } : { sessionId: launched.sessionId! },
    });
    return launched;
  }

  private async startWholeSkillLevel(
    request: { id: string; skillId: string; status: AssessmentRequestStatus },
    level: SkillLevel,
    userId: string,
  ) {
    if (request.status === AssessmentRequestStatus.COMPLETED) {
      throw new ConflictException('This request has already been settled.');
    }
    if (request.status === AssessmentRequestStatus.EXPIRED_UNBILLED) {
      throw new ConflictException('This invitation has expired.');
    }

    const child = await this.prisma.assessmentRequestLevel.findUnique({
      where: { assessmentRequestId_level: { assessmentRequestId: request.id, level } },
    });
    if (!child) throw new NotFoundException('This level is not part of this request.');
    if (child.badgeId) throw new ConflictException('You already hold a verified badge at this level.');

    if (request.status === AssessmentRequestStatus.ACCRUED_PENDING_START) {
      const { count } = await this.prisma.assessmentRequest.updateMany({
        where: { id: request.id, status: AssessmentRequestStatus.ACCRUED_PENDING_START, expiresAt: { gt: new Date() } },
        data: { status: AssessmentRequestStatus.STARTED, startedAt: new Date() },
      });
      if (count === 0) {
        const fresh = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: request.id } });
        if (fresh.status !== AssessmentRequestStatus.STARTED) {
          throw new ConflictException('This invitation has expired.');
        }
      }
    }

    if (child.attemptId) {
      const attempt = await this.prisma.attempt.findUniqueOrThrow({ where: { id: child.attemptId } });
      return { attemptId: child.attemptId, sessionId: null, assessmentId: attempt.assessmentId };
    }
    if (child.sessionId) {
      return { attemptId: null, sessionId: child.sessionId, assessmentId: null };
    }

    const launched = await this.launchLinkedAssessment(request.skillId, level, userId);
    await this.prisma.assessmentRequestLevel.update({
      where: { id: child.id },
      data: launched.attemptId ? { attemptId: launched.attemptId } : { sessionId: launched.sessionId! },
    });
    return launched;
  }

  /**
   * Creates the actual Attempt or AssessmentSession for one skill+level —
   * the one place both request shapes reach to do that, so TEST vs.
   * DISCUSSION resolution can't drift between them. assessmentId is
   * included alongside attemptId so the client can route straight to the
   * existing /assessments/[assessmentId] take-flow page — that page itself
   * POSTs /assessments/:id/attempts on mount, which is exactly
   * AssessmentsService.startAttempt's idempotent "active attempt already
   * exists" branch given the attempt this method just created. No new
   * candidate-facing take-flow UI needed.
   */
  private async launchLinkedAssessment(
    skillId: string,
    level: SkillLevel,
    userId: string,
  ): Promise<{ attemptId: string | null; sessionId: string | null; assessmentId: string | null }> {
    const format = await this.resolveFormat(skillId, level);
    if (format.type === 'TEST') {
      const attempt = await this.assessments.startAttempt(userId, format.assessmentId, { skipLevelAndRetakeChecks: true });
      return { attemptId: attempt.id, sessionId: null, assessmentId: format.assessmentId };
    }

    const { session } = await this.assessmentSessions.createSession(userId, { skipLevelAndRetakeChecks: true });
    return { attemptId: null, sessionId: session.id, assessmentId: null };
  }

  /** Employer-facing single request, reconciling/settling on read (see reconcile's own doc comment) before returning. */
  private readonly displayInclude = { skill: true, organization: true, badge: true } as const;

  async getForEmployer(orgId: string, requestId: string) {
    const request = await this.prisma.assessmentRequest.findUnique({ where: { id: requestId }, include: this.displayInclude });
    if (!request || request.orgId !== orgId) throw new NotFoundException('Assessment request not found');
    return this.withEmployerOutcome(await this.reconcile(request));
  }

  async listForEmployer(orgId: string, candidateId?: string) {
    const requests = await this.prisma.assessmentRequest.findMany({
      where: { orgId, ...(candidateId ? { candidateId } : {}) },
      include: this.displayInclude,
      orderBy: { createdAt: 'desc' },
    });
    const reconciled = await Promise.all(requests.map((r) => this.reconcile(r)));
    return Promise.all(reconciled.map((r) => this.withEmployerOutcome(r)));
  }

  /**
   * Adds the requesting employer's paid-for outcome on top of the shared
   * display fields. Legacy (level != null): unchanged — `passed` for any
   * completed request, plus `scorePercent`/`topicBreakdown` for a
   * completed TEST-format one specifically. Whole-skill (level: null):
   * adds a `levels` array, one entry per level, each independently showing
   * pass/fail/score — this is what lets the employer see "Foundational:
   * passed, Practitioner: not passed, Advanced: not attempted" rather than
   * one verdict for the whole request.
   *
   * Only ever called from getForEmployer/listForEmployer above, both
   * already orgId-scoped — that, not a check inside this method, is what
   * keeps "only the requesting employer sees score and breakdown" true.
   */
  private async withEmployerOutcome(request: any) {
    if (request.level !== null) {
      const passed = request.status === AssessmentRequestStatus.COMPLETED ? !!request.badgeId : null;
      let scorePercent: number | null = null;
      let topicBreakdown: TopicBreakdown | null = null;
      if (request.status === AssessmentRequestStatus.COMPLETED && request.attemptId) {
        const scored = await this.assessments.getScoreAndTopicBreakdown(request.attemptId);
        scorePercent = scored.scorePercent;
        topicBreakdown = scored.topicBreakdown;
      }
      return { ...request, passed, scorePercent, topicBreakdown };
    }

    const children = await this.prisma.assessmentRequestLevel.findMany({
      where: { assessmentRequestId: request.id },
      orderBy: { level: 'asc' },
    });
    const levels = await Promise.all(
      children.map(async (child) => {
        const outcome = await this.resolveChildOutcome(child);
        let scorePercent: number | null = null;
        let topicBreakdown: TopicBreakdown | null = null;
        if (outcome.isTerminal && child.attemptId) {
          const scored = await this.assessments.getScoreAndTopicBreakdown(child.attemptId);
          scorePercent = scored.scorePercent;
          topicBreakdown = scored.topicBreakdown;
        }
        return {
          level: child.level,
          attempted: outcome.isTerminal,
          passed: outcome.isTerminal ? !!outcome.badgeId : null,
          scorePercent,
          topicBreakdown,
        };
      }),
    );
    return { ...request, levels };
  }

  /** Candidate-facing: every request made about them, most recent first — pending invitations and history both, so the client can filter/section as it likes. */
  async listForCandidate(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) return [];
    const requests = await this.prisma.assessmentRequest.findMany({
      where: { candidateId: profile.id },
      include: this.displayInclude,
      orderBy: { createdAt: 'desc' },
    });
    const reconciled = await Promise.all(requests.map((r) => this.reconcile(r)));
    return Promise.all(reconciled.map((r) => this.withCandidateProgress(r)));
  }

  /**
   * Adds candidate-facing progress context that doesn't live on
   * AssessmentRequest itself. Legacy (level != null): unchanged —
   * `durationMins` for the one level, `submitted` for a STARTED
   * discussion-format request sitting with a reviewer. Whole-skill
   * (level: null): a `levels` array, one entry per level, each with its
   * own durationMins/attemptId/sessionId/submitted/alreadyBadged — a
   * candidate needs to see all three levels' state to pick which to start
   * next, not just one.
   */
  private async withCandidateProgress(request: any) {
    if (request.level !== null) {
      let durationMins: number | null = null;
      try {
        const format = await this.resolveFormat(request.skillId, request.level);
        durationMins =
          format.type === 'TEST' ? ((await this.prisma.assessment.findUnique({ where: { id: format.assessmentId } }))?.durationMins ?? null) : DISCUSSION_DURATION_MINS;
      } catch {
        // Catalog moved on since this request was created (assessment delisted, etc.) — no duration to show, not an error.
      }

      let submitted = false;
      if (request.sessionId) {
        const session = await this.prisma.assessmentSession.findUnique({ where: { id: request.sessionId }, select: { status: true } });
        submitted = session?.status === AssessmentSessionStatus.AWAITING_SCORING || session?.status === AssessmentSessionStatus.AWAITING_REVIEW;
      }

      return { ...request, durationMins, submitted };
    }

    const children = await this.prisma.assessmentRequestLevel.findMany({
      where: { assessmentRequestId: request.id },
      orderBy: { level: 'asc' },
    });
    const levels = await Promise.all(
      children.map(async (child) => {
        let durationMins: number | null = null;
        try {
          const format = await this.resolveFormat(request.skillId, child.level);
          durationMins =
            format.type === 'TEST' ? ((await this.prisma.assessment.findUnique({ where: { id: format.assessmentId } }))?.durationMins ?? null) : DISCUSSION_DURATION_MINS;
        } catch {
          // Catalog moved on since this request was created — no duration to show, not an error.
        }

        let submitted = false;
        if (child.sessionId) {
          const session = await this.prisma.assessmentSession.findUnique({ where: { id: child.sessionId }, select: { status: true } });
          submitted = session?.status === AssessmentSessionStatus.AWAITING_SCORING || session?.status === AssessmentSessionStatus.AWAITING_REVIEW;
        }

        return {
          level: child.level,
          attemptId: child.attemptId,
          sessionId: child.sessionId,
          alreadyBadged: !!child.badgeId,
          durationMins,
          submitted,
        };
      }),
    );
    return { ...request, levels };
  }

  /**
   * Pull-based reconciliation, checked on every employer/candidate read —
   * deliberately NOT a push-based hook from AssessmentsService.gradeAttempt
   * / ReviewService.decide, which would require those modules to import
   * this one while this module already imports them (a circular module
   * dependency) just to notify a side-concern those services have no real
   * reason to know about. This keeps the blast radius on grading/review at
   * zero: they're entirely unaware employer-triggered-assessment exists.
   *
   * Legacy (level != null): unchanged single-attempt STARTED->COMPLETED
   * check. Whole-skill (level: null): delegates to maybeSettleWholeSkill,
   * which settles at 'COMPLETE' pricing the moment all three levels are
   * found terminal — "immediately" in the sense that the very next read
   * (by either side) or the hourly settlement sweep catches it, not a
   * synchronous push the instant the third grade lands (see this class's
   * own doc comment on why pull-based).
   */
  private async reconcile(request: {
    id: string;
    orgId: string;
    candidateId: string;
    level: SkillLevel | null;
    status: AssessmentRequestStatus;
    attemptId: string | null;
    sessionId: string | null;
    startedAt: Date | null;
  }): Promise<any> {
    if (request.status !== AssessmentRequestStatus.STARTED) return request;
    if (request.level !== null) return this.reconcileLegacy(request);
    return this.maybeSettleWholeSkill(request);
  }

  private async reconcileLegacy(request: { id: string; attemptId: string | null; sessionId: string | null }): Promise<any> {
    let terminal: { badgeId: string | null } | null = null;
    if (request.attemptId) {
      const attempt = await this.prisma.attempt.findUnique({ where: { id: request.attemptId }, include: { badge: true } });
      if (attempt?.status === AttemptStatus.GRADED) terminal = { badgeId: attempt.badge?.id ?? null };
    } else if (request.sessionId) {
      const session = await this.prisma.assessmentSession.findUnique({ where: { id: request.sessionId }, include: { badge: true } });
      const terminalSessionStatuses: AssessmentSessionStatus[] = [AssessmentSessionStatus.ISSUED, AssessmentSessionStatus.REJECTED];
      if (session && terminalSessionStatuses.includes(session.status)) {
        terminal = { badgeId: session.badge?.id ?? null };
      }
    }
    if (!terminal) return request;

    const { count } = await this.prisma.assessmentRequest.updateMany({
      where: { id: request.id, status: AssessmentRequestStatus.STARTED },
      data: { status: AssessmentRequestStatus.COMPLETED, badgeId: terminal.badgeId },
    });
    const updated = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: request.id }, include: this.displayInclude });
    if (count === 1) await this.notifyEmployerResultReady(updated);
    return updated;
  }

  /**
   * Whether one AssessmentRequestLevel child has reached a terminal
   * outcome — a pre-existing badge set at creation, or the linked
   * attempt/session reaching a terminal grade. Deliberately never cached
   * back onto the child row (same "thin, no state that can drift"
   * philosophy as the parent's own doc comment): the linked
   * Attempt/AssessmentSession/Badge rows are always the single source of
   * truth, re-derived on every read, exactly like the legacy path already
   * does for its one attempt.
   */
  private async resolveChildOutcome(child: {
    id: string;
    attemptId: string | null;
    sessionId: string | null;
    badgeId: string | null;
  }): Promise<{ isTerminal: boolean; badgeId: string | null }> {
    if (child.badgeId) return { isTerminal: true, badgeId: child.badgeId };
    if (child.attemptId) {
      const attempt = await this.prisma.attempt.findUnique({ where: { id: child.attemptId }, include: { badge: true } });
      if (attempt?.status === AttemptStatus.GRADED) return { isTerminal: true, badgeId: attempt.badge?.id ?? null };
      return { isTerminal: false, badgeId: null };
    }
    if (child.sessionId) {
      const session = await this.prisma.assessmentSession.findUnique({ where: { id: child.sessionId }, include: { badge: true } });
      const terminalSessionStatuses: AssessmentSessionStatus[] = [AssessmentSessionStatus.ISSUED, AssessmentSessionStatus.REJECTED];
      if (session && terminalSessionStatuses.includes(session.status)) return { isTerminal: true, badgeId: session.badge?.id ?? null };
      return { isTerminal: false, badgeId: null };
    }
    return { isTerminal: false, badgeId: null };
  }

  /**
   * The single place that decides whether a whole-skill STARTED request
   * should settle right now, and at which tier — shared by reconcile()
   * (called on every read, checks "all three attempted" only, ignoring
   * the 14-day deadline) and AssessmentRequestSettlementJob (checked only
   * for rows already past the deadline, but still re-checks "all three
   * attempted" first via this same method, so a request that happens to
   * complete right at the deadline is never mispriced as PARTIAL just
   * because nobody read it in between).
   */
  async maybeSettleWholeSkill(request: { id: string; orgId: string; startedAt: Date | null }): Promise<any> {
    const children = await this.prisma.assessmentRequestLevel.findMany({ where: { assessmentRequestId: request.id } });
    const outcomes = await Promise.all(children.map((c) => this.resolveChildOutcome(c)));
    const allTerminal = outcomes.length > 0 && outcomes.every((o) => o.isTerminal);
    if (allTerminal) return this.settle(request, 'COMPLETE');

    const deadline = request.startedAt ? new Date(request.startedAt.getTime() + SETTLEMENT_WINDOW_MS) : null;
    if (deadline && deadline <= new Date()) return this.settle(request, 'PARTIAL');

    return this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: request.id }, include: this.displayInclude });
  }

  /**
   * Writes the Transaction for a whole-skill request's now-known outcome
   * and flips it to COMPLETED — the only place a whole-skill request's
   * amount/transactionId are ever set (see AssessmentRequest's own schema
   * doc comment on why they're null until now). Idempotent against a race
   * between the pull-based reconcile-on-read path and the settlement
   * sweep both reaching the same STARTED request at once: the atomic
   * conditional updateMany (WHERE status = STARTED) is what lets only one
   * of them actually settle it, same race-closing shape used throughout
   * this module (start-vs-expiry, STARTED-vs-COMPLETED).
   */
  private async settle(request: { id: string; orgId: string }, outcome: SettlementOutcome): Promise<any> {
    const { count } = await this.prisma.assessmentRequest.updateMany({
      where: { id: request.id, status: AssessmentRequestStatus.STARTED },
      data: { status: AssessmentRequestStatus.COMPLETED },
    });
    if (count === 0) {
      return this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: request.id }, include: this.displayInclude });
    }

    const basePaise = outcome === 'COMPLETE' ? completeBaseAmountPaise() : baseAmountPaise();
    const billingProfileId = await this.billingProfiles.ensureMinimalBillingProfile(request.orgId);
    const profile = await this.prisma.billingProfile.findUnique({ where: { id: billingProfileId }, select: { gstStateCode: true } });
    const placeOfSupplyStateCode = profile?.gstStateCode ?? DEFAULT_PLACE_OF_SUPPLY_STATE_CODE;
    const split = splitGst(basePaise, placeOfSupplyStateCode);

    const transaction = await this.transactions.recordSystemTransaction(billingProfileId, {
      amountPaise: split.totalPaise,
      currency: CURRENCY,
      type: TransactionType.ASSESSMENT_REQUEST_ACCRUAL,
      status: TransactionStatus.PENDING,
      description:
        outcome === 'COMPLETE' ? 'MyAmbii assessment request charge — all levels attempted' : 'MyAmbii assessment request charge — started, not all levels attempted',
      gst: split,
    });

    await this.prisma.assessmentRequest.update({
      where: { id: request.id },
      data: { amount: split.totalPaise, transactionId: transaction.id },
    });

    const updated = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: request.id }, include: this.displayInclude });
    await this.notifyEmployerSettled(updated, outcome);
    return updated;
  }

  /** Every level this skill can actually be requested at — a live TEST assessment, or the one fixed DISCUSSION skill+level (RAG Systems L2 today). Not every skill offers all three; a whole-skill request only ever covers the ones it does. */
  private async offeredLevels(skillId: string): Promise<SkillLevel[]> {
    const levels: SkillLevel[] = [];
    for (const level of [SkillLevel.L1, SkillLevel.L2, SkillLevel.L3]) {
      const format = await this.resolveFormat(skillId, level).catch(() => null);
      if (format) levels.push(level);
    }
    return levels;
  }

  private async assertRequestableSkill(skillId: string): Promise<SkillLevel[]> {
    const levels = await this.offeredLevels(skillId);
    if (levels.length === 0) {
      throw new BadRequestException('This skill has no assessment levels available to request.');
    }
    return levels;
  }

  private async resolveFormat(
    skillId: string,
    level: SkillLevel,
  ): Promise<{ type: 'TEST'; assessmentId: string } | { type: 'DISCUSSION' }> {
    const assessment = await this.prisma.assessment.findFirst({ where: { skillId, targetLevel: level, isLive: true } });
    if (assessment) return { type: 'TEST', assessmentId: assessment.id };

    const skill = await this.prisma.skill.findUnique({ where: { id: skillId } });
    if (skill?.name === DISCUSSION_SKILL_NAME && level === DISCUSSION_LEVEL) return { type: 'DISCUSSION' };

    throw new NotFoundException('This skill/level combination is not available for assessment.');
  }

  private async getOwnedByCandidate(requestId: string, userId: string) {
    const request = await this.prisma.assessmentRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Assessment request not found');
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile || request.candidateId !== profile.id) throw new ForbiddenException();
    return request;
  }

  private async notifyCandidateInvited(requestId: string): Promise<void> {
    try {
      const request = await this.prisma.assessmentRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: { organization: true, skill: true, candidateProfile: true, levels: true },
      });
      const levelNames = request.levels.map((l) => l.level).join(', ');
      await this.notifications.sendEmail(
        request.candidateProfile.userId,
        NotificationType.ASSESSMENT_REQUEST_INVITE,
        `${request.organization.name} invited you to verify your ${request.skill.name} skills`,
        `<p><strong>${request.organization.name}</strong> has invited you to verify <strong>${request.skill.name}</strong> ` +
          `across all of its levels (${levelNames}). Attempt them in any order.</p>` +
          `<p>Start at least one within 5 days, before ${request.expiresAt?.toDateString()} — it's free until you do.</p>` +
          `<p>When you finish a level, ${request.organization.name} will see whether you passed, your score, and how ` +
          `you performed by topic — for that level. They won't see your individual answers or the questions themselves.</p>`,
      );
    } catch {
      // Best-effort — same contract as every other NotificationsService caller.
    }
  }

  private async notifyEmployerResultReady(request: { id: string; orgId: string }): Promise<void> {
    try {
      const full = await this.prisma.assessmentRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { skill: true, candidateProfile: true, requestedByUser: true, badge: true },
      });
      const passed = !!full.badgeId;
      const url = `${WEB_BASE_URL}/employer/shortlist?candidateId=${full.candidateId}`;
      await this.notifications.sendEmail(
        full.requestedByUserId,
        NotificationType.ASSESSMENT_REQUEST_RESULT,
        `Result ready: ${full.candidateProfile.fullName ?? 'Candidate'} — ${full.skill.name} ${full.level}`,
        `<p>The ${full.skill.name} ${full.level} assessment you requested for ` +
          `<strong>${full.candidateProfile.fullName ?? 'this candidate'}</strong> is complete.</p>` +
          `<p>Result: <strong>${passed ? 'Passed — badge issued' : 'Not passed'}</strong>.</p>` +
          `<p><a href="${url}">View on the shortlist</a></p>`,
      );
    } catch {
      // Best-effort.
    }
  }

  private async notifyEmployerSettled(request: { id: string; orgId: string }, outcome: SettlementOutcome): Promise<void> {
    try {
      const full = await this.prisma.assessmentRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: { skill: true, candidateProfile: true, requestedByUser: true, levels: true },
      });
      const url = `${WEB_BASE_URL}/employer/shortlist?candidateId=${full.candidateId}`;
      const summary = full.levels
        .map((l) => `${l.level}: ${l.badgeId ? 'Passed' : l.attemptId || l.sessionId ? 'Not passed' : 'Not attempted'}`)
        .join(', ');
      await this.notifications.sendEmail(
        full.requestedByUserId,
        NotificationType.ASSESSMENT_REQUEST_RESULT,
        `Result ready: ${full.candidateProfile.fullName ?? 'Candidate'} — ${full.skill.name}`,
        `<p>The ${full.skill.name} assessment you requested for <strong>${full.candidateProfile.fullName ?? 'this candidate'}</strong> is settled.</p>` +
          `<p>Results by level: <strong>${summary}</strong>.</p>` +
          `<p>Charge: <strong>${outcome === 'COMPLETE' ? 'all levels attempted' : 'started, not all levels attempted'}</strong> — this will appear on your next invoice.</p>` +
          `<p><a href="${url}">View on the shortlist</a></p>`,
      );
    } catch {
      // Best-effort.
    }
  }
}
