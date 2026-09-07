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
 * Paise, GST-EXCLUSIVE. "$5" in the product brief, later revised to ₹150
 * base (₹177 GST-inclusive — see splitGst) to bring this flow's GST
 * treatment in line with subscriptions'. Configurable per the brief's
 * "amount configurable" — env override, hardcoded fallback, never
 * client-supplied. The env var name predates the base/exclusive-vs-total
 * distinction and still names the base amount, not the amount actually
 * accrued — baseAmountPaise() below is the only thing that reads it.
 */
const DEFAULT_BASE_AMOUNT_PAISE = 15000;
const CURRENCY = 'INR';
const EXPIRY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function baseAmountPaise(): number {
  const fromEnv = process.env.ASSESSMENT_REQUEST_AMOUNT_PAISE;
  const parsed = fromEnv ? Number(fromEnv) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BASE_AMOUNT_PAISE;
}

/**
 * The amount accrued — GST-inclusive total, shown to the employer before
 * they confirm (see the frontend's own disclosure copy) and recorded
 * verbatim on the AssessmentRequest/Transaction. Place of supply doesn't
 * change this (splitGst's totalPaise is state-invariant, only the
 * CGST/SGST-vs-IGST composition varies), so this can be computed with no
 * BillingProfile/org context yet — mirrors how SUBSCRIPTION_PRICING's
 * Razorpay Plans are priced at the GST-inclusive total regardless of which
 * state a given subscriber is in.
 */
function chargeAmountPaise(): number {
  return splitGst(baseAmountPaise(), DEFAULT_PLACE_OF_SUPPLY_STATE_CODE).totalPaise;
}

/**
 * Employer-triggered candidate assessments — postpaid (2026-09, replacing
 * the original prepaid Razorpay-per-request model). No payment happens at
 * request time at all: the employer sees the exact amount up front (see
 * the frontend's disclosure before submitting) and confirms, this creates
 * the AssessmentRequest and accrues a Transaction for it immediately (the
 * tax point is the supply being requested, not a payment — see
 * TransactionType.ASSESSMENT_REQUEST_ACCRUAL's own doc comment), and every
 * org's accrued, billable requests are aggregated into one GST tax invoice
 * a month, settled by bank transfer offline (see
 * AssessmentRequestInvoicingJob). No usage limit, no blocking on an
 * overdue invoice — this module has no entitlement/payment gate at all,
 * by design.
 *
 * The old Razorpay integration (order creation, HMAC-SHA256 signature
 * verification, refund-on-expiry) is gone entirely, not left dormant —
 * see the commit that made this change for the reasoning (zero production
 * rows depended on it, and the subscriptions module's own Razorpay
 * webhook verification remains a working reference if prepaid ever
 * returns).
 *
 * State machine (AssessmentRequestStatus):
 *   (badge check) --already badged--> ALREADY_BADGED [terminal, never accrues]
 *   (badge check) --not badged--> ACCRUED_PENDING_START [Transaction written immediately, PENDING]
 *   ACCRUED_PENDING_START --candidate starts within window--> STARTED [billable — Transaction stays PENDING until invoiced]
 *   ACCRUED_PENDING_START --expiresAt passes, never started--> EXPIRED_UNBILLED [Transaction voided — see AssessmentRequestExpiryJob]
 *   STARTED --linked attempt/session reaches a terminal decision--> COMPLETED
 * STARTED is never excluded from billing, and ACCRUED_PENDING_START is
 * never both started and excluded — see startFromRequest's atomic
 * transition and the expiry job's own doc comment for how each direction
 * of that race is closed (same race-closing shape as the old refund job,
 * just without an external payment call on either side of it now).
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
   * The whole employer flow, in one call — no separate verify step exists
   * anymore (postpaid, see this class's own doc comment). Validates the
   * candidate is actually on this org's shortlist (IDOR guard — an
   * employer may only request assessments for candidates they've
   * shortlisted) and that skillId+level is something the catalog can
   * actually deliver, then does the already-badged check — if it's
   * already badged, this returns immediately with the existing badge and
   * never accrues anything. Otherwise it creates the AssessmentRequest as
   * ACCRUED_PENDING_START and records the accrual (amount decided here,
   * server-side, never from the client) in the same call — the frontend
   * is expected to have already disclosed this exact amount to the
   * employer and gotten explicit confirmation before calling this at all
   * (see AssessCandidateAction.tsx's own confirmation step), since there
   * is no payment step left to double as that disclosure.
   */
  async create(orgId: string, requestedByUserId: string, candidateId: string, skillId: string, level: SkillLevel) {
    const shortlisted = await this.prisma.shortlistEntry.findFirst({ where: { orgId, candidateId } });
    if (!shortlisted) throw new ForbiddenException('This candidate is not on your shortlist.');

    const candidateProfile = await this.prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    if (!candidateProfile) throw new NotFoundException('Candidate not found');

    await this.assertRequestableSkillLevel(skillId, level);

    const existingBadge = await this.badgeResolver.resolveLevelMap(candidateProfile.userId, skillId);
    const badge = existingBadge[level];
    if (badge) {
      const request = await this.prisma.assessmentRequest.create({
        data: {
          orgId,
          requestedByUserId,
          candidateId,
          skillId,
          level,
          status: AssessmentRequestStatus.ALREADY_BADGED,
          badgeId: badge.id,
        },
      });
      return { alreadyBadged: true as const, badge, requestId: request.id };
    }

    const chargedAmount = chargeAmountPaise();
    const createdAt = new Date();
    const request = await this.prisma.assessmentRequest.create({
      data: {
        orgId,
        requestedByUserId,
        candidateId,
        skillId,
        level,
        status: AssessmentRequestStatus.ACCRUED_PENDING_START,
        amount: chargedAmount,
        expiresAt: new Date(createdAt.getTime() + EXPIRY_WINDOW_MS),
      },
    });

    await this.recordAccrual(request.id, orgId, chargedAmount);
    await this.notifyCandidateInvited(request.id);
    return { alreadyBadged: false as const, requestId: request.id, amount: chargedAmount, currency: CURRENCY };
  }

  /**
   * Ledger + GST split for a just-created request — mirrors
   * RazorpayWebhookService.recordCharge's own posture (system-actor
   * Transaction, defensive totalPaise assertion) for the one-time-charge
   * side of the business, but written PENDING, not SUCCEEDED: this is an
   * accrual, not a captured payment (see TransactionStatus's own doc
   * comment) — it only reaches SUCCEEDED once AssessmentRequestInvoicingJob
   * actually invoices it, or VOIDED if the request expires unstarted (see
   * AssessmentRequestExpiryJob). Runs synchronously inside create(), not
   * fire-and-forget: unlike a document (queued, retried independently —
   * see the `documents` module), the ledger entry for an obligation that
   * has already been created must exist before this call returns, or an
   * AssessmentRequest could exist with nothing backing its `amount`
   * anywhere in the ledger. A failure here throws and the caller sees a
   * 500 — there is no retried-verify-call idempotency concern anymore
   * (that existed purely to handle a client resubmitting a Razorpay
   * checkout response), since create() is one request/response round trip
   * with nothing to retry against.
   */
  private async recordAccrual(requestId: string, orgId: string, chargedAmount: number): Promise<void> {
    const billingProfileId = await this.billingProfiles.ensureMinimalBillingProfile(orgId);

    const basePaise = baseAmountPaise();
    const profile = await this.prisma.billingProfile.findUnique({
      where: { id: billingProfileId },
      select: { gstStateCode: true },
    });
    const placeOfSupplyStateCode = profile?.gstStateCode ?? DEFAULT_PLACE_OF_SUPPLY_STATE_CODE;
    const split = splitGst(basePaise, placeOfSupplyStateCode);

    if (split.totalPaise !== chargedAmount) {
      // Same defensive posture as RazorpayWebhookService.recordCharge — a
      // misconfiguration (env var changed between amount-decided and
      // accrual-recorded, both in the same call here, so this should be
      // unreachable in practice) fails loud rather than recording a split
      // that doesn't add up to what was actually accrued.
      this.logger.error(
        `AssessmentRequest ${requestId}: computed GST total ${split.totalPaise} does not match accrued amount ${chargedAmount} — recording amountPaise only, no tax split.`,
      );
    }

    const transaction = await this.transactions.recordSystemTransaction(billingProfileId, {
      amountPaise: chargedAmount,
      currency: CURRENCY,
      type: TransactionType.ASSESSMENT_REQUEST_ACCRUAL,
      status: TransactionStatus.PENDING,
      description: 'MyAmbii assessment request charge',
      gst: split.totalPaise === chargedAmount ? split : undefined,
    });

    await this.prisma.assessmentRequest.update({ where: { id: requestId }, data: { transactionId: transaction.id } });
  }

  /**
   * Candidate-facing: start the assessment this request accrued for.
   * Atomic conditional transition (updateMany WHERE status =
   * ACCRUED_PENDING_START AND expiresAt > now) is what closes the
   * start-vs-expiry race in both directions — whichever of this call and
   * the expiry job's own conditional update actually flips the row first
   * is the one that "wins"; the loser's WHERE clause simply matches zero
   * rows, so a request can never end up both STARTED and excluded from
   * billing. A second call after this one already won (double-click, page
   * reload) matches zero rows too, but for a different reason — see the
   * reload below, which treats "already STARTED with startedAt already
   * set" as this same candidate's already-started attempt/session and
   * returns it rather than erroring, mirroring
   * AssessmentsService.startAttempt's own idempotent pattern (never a
   * double-start creating two attempts).
   */
  async startFromRequest(requestId: string, userId: string) {
    const request = await this.getOwnedByCandidate(requestId, userId);

    const { count } = await this.prisma.assessmentRequest.updateMany({
      where: { id: requestId, status: AssessmentRequestStatus.ACCRUED_PENDING_START, expiresAt: { gt: new Date() } },
      data: { status: AssessmentRequestStatus.STARTED, startedAt: new Date() },
    });

    if (count === 0) {
      const fresh = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (fresh.status === AssessmentRequestStatus.STARTED) {
        return this.launchLinkedAssessment(fresh, userId, { alreadyStarted: true });
      }
      throw new ConflictException('This invitation has expired.');
    }

    const started = await this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: requestId } });
    return this.launchLinkedAssessment(started, userId, { alreadyStarted: false });
  }

  /** Only ever called immediately after this request just won (or already held) the STARTED transition — creates/links the actual Attempt or AssessmentSession. */
  /**
   * assessmentId is included alongside attemptId so the client can route
   * straight to the existing /assessments/[assessmentId] take-flow page —
   * that page itself POSTs /assessments/:id/attempts on mount, which is
   * exactly AssessmentsService.startAttempt's idempotent "active attempt
   * already exists" branch given the attempt this method just created; it
   * returns the same attempt (refunding the entitlement charge that route
   * speculatively made, same as any other idempotent re-entry there). No
   * new candidate-facing take-flow UI needed — this is the "reuse the
   * existing engine" property extending all the way to the frontend.
   */
  private async launchLinkedAssessment(
    request: { id: string; skillId: string; level: SkillLevel; attemptId: string | null; sessionId: string | null },
    userId: string,
    opts: { alreadyStarted: boolean },
  ) {
    if (opts.alreadyStarted && request.attemptId) {
      const attempt = await this.prisma.attempt.findUniqueOrThrow({ where: { id: request.attemptId } });
      return { attemptId: request.attemptId, sessionId: null, assessmentId: attempt.assessmentId };
    }
    if (opts.alreadyStarted && request.sessionId) {
      return { attemptId: null, sessionId: request.sessionId, assessmentId: null };
    }

    const format = await this.resolveFormat(request.skillId, request.level);
    if (format.type === 'TEST') {
      const attempt = await this.assessments.startAttempt(userId, format.assessmentId, { skipLevelAndRetakeChecks: true });
      await this.prisma.assessmentRequest.update({ where: { id: request.id }, data: { attemptId: attempt.id } });
      return { attemptId: attempt.id, sessionId: null, assessmentId: format.assessmentId };
    }

    const { session } = await this.assessmentSessions.createSession(userId, { skipLevelAndRetakeChecks: true });
    await this.prisma.assessmentRequest.update({ where: { id: request.id }, data: { sessionId: session.id } });
    return { attemptId: null, sessionId: session.id, assessmentId: null };
  }

  /** Employer-facing single request, reconciling STARTED->COMPLETED on read (see reconcile's own doc comment) before returning. */
  /** display: display-only fields both the employer and candidate list/get views need — never used by any enforcement/state-machine logic above. badge (hash/level/expiry) is display-only too, same as skill/organization — this is what makes the badge visible on the request at all, not just its id. */
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
   * display fields: `passed` for any completed request (TEST or DISCUSSION
   * format), plus `scorePercent`/`topicBreakdown` for a completed,
   * TEST-format one specifically — reusing AssessmentsService's
   * getScoreAndTopicBreakdown rather than re-deriving pass/fail or
   * re-implementing the topic aggregation here (see that method's own doc
   * comment, and topic-breakdown.ts's, for the leak-boundary reasoning this
   * shares with the candidate-facing endpoint).
   *
   * Only ever called from getForEmployer/listForEmployer above, both already
   * orgId-scoped (OrgMemberGuard plus the explicit orgId check in
   * getForEmployer) — that, not a check inside this method, is what keeps
   * "only the requesting employer sees score and breakdown" true. Never
   * called from listForCandidate or any badge-browsing path.
   *
   * scorePercent/topicBreakdown are `null` — not a zeroed-out breakdown —
   * for anything that isn't a completed, attempt-linked request. A
   * DISCUSSION-format request (RAG Systems L2) resolves via `sessionId`,
   * never `attemptId`, and has no MCQ score/topic concept at all; the
   * frontend must render `null` as "not applicable to this format," not as
   * a 0% score or an empty breakdown card.
   */
  private async withEmployerOutcome(request: any) {
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
   * AssessmentRequest itself — how long the linked assessment is expected
   * to take (`durationMins`, resolved via the same skillId+level ->
   * format lookup `create()` validates against, so TEST and DISCUSSION
   * both resolve without needing an assessmentId stored on the request),
   * and whether a STARTED discussion-format request is actually sitting
   * with a reviewer (`submitted`) rather than genuinely in progress —
   * mirrors the AWAITING_SCORING/AWAITING_REVIEW check the candidate
   * dashboard already does for the self-serve discussion flow. A
   * TEST-format request has no such intermediate state (grading is
   * synchronous), so `submitted` is always false when there's no
   * sessionId.
   */
  private async withCandidateProgress(request: any) {
    let durationMins: number | null = null;
    try {
      const format = await this.resolveFormat(request.skillId, request.level);
      durationMins = format.type === 'TEST' ? (await this.prisma.assessment.findUnique({ where: { id: format.assessmentId } }))?.durationMins ?? null : DISCUSSION_DURATION_MINS;
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

  /**
   * Pull-based STARTED->COMPLETED reconciliation, checked on every
   * employer/candidate read and swept proactively by the expiry job (see
   * AssessmentRequestsRefundJob) — deliberately NOT a push-based hook from
   * AssessmentsService.gradeAttempt / ReviewService.decide, which would
   * require those modules to import this one while this module already
   * imports them (a circular module dependency) just to notify a
   * side-concern those services have no real reason to know about. This
   * keeps the blast radius on grading/review at zero: they're entirely
   * unaware employer-triggered-assessment exists.
   */
  // Return type deliberately loose (Promise<any>, not the narrow parameter
  // shape): the STARTED->COMPLETED branch re-reads the full row via
  // findUniqueOrThrow after updating it, so callers always get every
  // AssessmentRequest field either way, not just the handful this method
  // itself needs to read.
  private async reconcile(request: {
    id: string;
    status: AssessmentRequestStatus;
    attemptId: string | null;
    sessionId: string | null;
    orgId: string;
    candidateId: string;
  }): Promise<any> {
    if (request.status !== AssessmentRequestStatus.STARTED) return request;

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

  /** A skill+level the employer can actually request: either a live TEST assessment, or exactly the one fixed DISCUSSION skill+level (RAG Systems L2 today — see rag-systems-l2.rubric.ts). */
  private async assertRequestableSkillLevel(skillId: string, level: SkillLevel): Promise<void> {
    const format = await this.resolveFormat(skillId, level).catch(() => null);
    if (!format) {
      throw new BadRequestException('This skill/level combination is not available for assessment.');
    }
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
        include: { organization: true, skill: true, candidateProfile: true },
      });
      // Disclosure copy depends on format — a TEST (MCQ) request gets an
      // employer score/topic breakdown (see getScoreAndTopicBreakdown
      // above), a DISCUSSION one (RAG Systems L2) only ever gets pass/fail;
      // saying "your score" on a format that has none would be dishonest,
      // not just imprecise. Same disclosure as EmployerInvitations.tsx's
      // pre-start card — both places exist so a candidate can't reach
      // "start" without having been told what the requesting employer sees.
      const format = await this.resolveFormat(request.skillId, request.level).catch(() => null);
      const disclosure =
        format?.type === 'TEST'
          ? `<p>When you finish, ${request.organization.name} will see whether you passed, your score, and how you ` +
            `performed by topic. They won't see your individual answers or the questions themselves.</p>`
          : `<p>When you finish, ${request.organization.name} will see whether you passed. They won't see the ` +
            `conversation itself.</p>`;
      await this.notifications.sendEmail(
        request.candidateProfile.userId,
        NotificationType.ASSESSMENT_REQUEST_INVITE,
        `${request.organization.name} invited you to take a ${request.skill.name} ${request.level} assessment`,
        `<p><strong>${request.organization.name}</strong> has invited you to take a verified ` +
          `<strong>${request.skill.name} ${request.level}</strong> assessment.</p>` +
          `<p>It's free to you — start within 5 days, before ${request.expiresAt?.toDateString()}.</p>` +
          disclosure,
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
      // No dedicated per-request detail page exists in the employer portal
      // today — the closest thing is the candidate's card on the shortlist
      // (AssessCandidateAction, rendered from EmployerShortlist), which
      // already shows this request's status. That page already supports
      // query-param-seeded filtering (?stage=/&jobId=, see its own comment)
      // for exactly this kind of deep link, so ?candidateId= follows the
      // same shape rather than inventing a new pattern.
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
}
