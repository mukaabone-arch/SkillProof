import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssessmentRequestStatus, AssessmentSessionStatus, AttemptStatus, NotificationType, SkillLevel, TransactionStatus, TransactionType } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssessmentsService } from '../assessments/assessments.service';
import { TopicBreakdown } from '../assessments/topic-breakdown';
import { AssessmentSessionsService } from '../assessment-sessions/assessment-sessions.service';
import { BadgeResolverService } from '../badges/badge-resolver.service';
import { SKILL_LEVEL as DISCUSSION_LEVEL, SKILL_NAME as DISCUSSION_SKILL_NAME } from '../assessment-sessions/rag-systems-l2.rubric';
import { RAZORPAY_GATEWAY, RazorpayGateway } from './razorpay-gateway';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { TransactionsService } from '../billing/transactions.service';
import { AssessmentRequestBillingProfileService } from './assessment-request-billing-profile.service';
import { splitGst, DEFAULT_PLACE_OF_SUPPLY_STATE_CODE } from '../../config/gst.config';

/**
 * Paise, GST-EXCLUSIVE. "$5" in the product brief, but this Razorpay
 * account is INR-only (see the feat/razorpay-test STEP 0 investigation —
 * no evidence of multi-currency/international settlement being
 * configured); the brief's flat ₹500 was later revised down to ₹150 base
 * (₹177 GST-inclusive — see splitGst) as part of bringing this flow's GST
 * treatment in line with subscriptions'. Configurable per the brief's
 * "amount configurable" — env override, hardcoded fallback, never
 * client-supplied. The env var name predates the base/exclusive-vs-total
 * distinction and still names the base amount, not the amount actually
 * charged — baseAmountPaise() below is the only thing that reads it.
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
 * The amount actually charged via Razorpay — GST-inclusive total. Place of
 * supply doesn't change this (splitGst's totalPaise is state-invariant,
 * only the CGST/SGST-vs-IGST composition varies), so this can be computed
 * once at order-creation time with no BillingProfile/org context yet —
 * mirrors how SUBSCRIPTION_PRICING's Razorpay Plans are priced at the
 * GST-inclusive total regardless of which state a given subscriber is in.
 */
function chargeAmountPaise(): number {
  return splitGst(baseAmountPaise(), DEFAULT_PLACE_OF_SUPPLY_STATE_CODE).totalPaise;
}

interface OrderNotes {
  orgId: string;
  requestedByUserId: string;
  candidateId: string;
  skillId: string;
  level: string;
}

/**
 * Employer-triggered candidate assessments, pay-per-assessment — Option C
 * (pay-then-refund), not authorize-then-capture. STEP 0 on this branch
 * (see the payments/test/create-auth-order harness and its report) found
 * Razorpay's manual-capture hold isn't reliably honored for UPI — the
 * dominant method in India — so this charges normally at request time
 * (works for every method, including UPI) and refunds automatically if the
 * candidate never starts within the 5-day window. Signature verification
 * reuses the exact proven HMAC-SHA256/timingSafeEqual pattern from
 * PaymentsService.verifyTestPayment; this is a fresh implementation rather
 * than a shared import because that module is explicitly throwaway
 * scaffolding (see its own doc comment) and this one additionally needs
 * refunds, which it never had.
 *
 * State machine (AssessmentRequestStatus):
 *   (badge check) --already badged--> ALREADY_BADGED [terminal, never paid]
 *   (badge check) --not badged, paid+verified--> PAID_PENDING_START
 *   PAID_PENDING_START --candidate starts within window--> STARTED
 *   PAID_PENDING_START --expiresAt passes, never started--> EXPIRED_REFUNDED
 *                                                        (or REFUND_FAILED,
 *                                                         retried until it is)
 *   STARTED --linked attempt/session reaches a terminal decision--> COMPLETED
 * STARTED is never refunded, and PAID_PENDING_START is never both started
 * and refunded — see startFromRequest's atomic transition and the expiry
 * job's own doc comment for how each direction of that race is closed.
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
    @Inject(RAZORPAY_GATEWAY) private readonly razorpay: RazorpayGateway,
    private readonly transactions: TransactionsService,
    private readonly billingProfiles: AssessmentRequestBillingProfileService,
  ) {}

  /**
   * Step 1 of the employer flow. Validates the candidate is actually on
   * this org's shortlist (IDOR guard — an employer may only request
   * assessments for candidates they've shortlisted) and that skillId+level
   * is something the catalog can actually deliver, then does the
   * already-badged check BEFORE any payment exists — if it's already
   * badged, this returns immediately with the existing badge and never
   * touches Razorpay. Otherwise it creates a Razorpay order (amount decided
   * here, server-side, never from the client) and pins the request context
   * (org/candidate/skill/level) into the order's own `notes` — verifyAndCreate
   * reads those back from Razorpay rather than trusting whatever the client
   * resubmits at verify time, so a payment can never be credited toward a
   * different candidate/skill/level than what was actually authorized here.
   */
  async initiate(orgId: string, requestedByUserId: string, candidateId: string, skillId: string, level: SkillLevel) {
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

    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
      throw new BadRequestException('Razorpay is not configured — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET.');
    }

    const amount = chargeAmountPaise();
    const notes: OrderNotes = { orgId, requestedByUserId, candidateId, skillId, level };
    const order = await this.razorpay.createOrder({
      amount,
      currency: CURRENCY,
      receipt: `assessreq_${Date.now()}`,
      notes: notes as unknown as Record<string, string>,
    });

    return { alreadyBadged: false as const, orderId: order.id, keyId, amount, currency: CURRENCY };
  }

  /**
   * Step 2 of the employer flow — the one security-critical step. Same
   * HMAC-SHA256("{order_id}|{payment_id}", Key Secret) + timingSafeEqual
   * check proven in PaymentsService.verifyTestPayment: a client claiming
   * "payment succeeded" proves nothing by itself, so nothing is persisted
   * until this passes. Idempotent on razorpayPaymentId — a duplicate call
   * (double-click, retried request) returns the already-created row rather
   * than creating a second one; a plain check-then-create is proportionate
   * here (unlike EntitlementsService's usage counters or the OTP store,
   * which face many truly concurrent requests per key, one employer
   * completing one checkout is not a hot path a race is realistically
   * expected on).
   */
  async verifyAndCreate(orgId: string, razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) throw new BadRequestException('Razorpay is not configured — set RAZORPAY_KEY_SECRET.');

    const expected = createHmac('sha256', secret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(razorpaySignature, 'hex');
    const verified = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
    if (!verified) {
      this.logger.warn('AssessmentRequest payment signature verification failed');
      throw new BadRequestException('Payment could not be verified.');
    }

    const existing = await this.prisma.assessmentRequest.findFirst({ where: { razorpayPaymentId } });
    if (existing) {
      // Idempotent on razorpayPaymentId (see this method's own doc
      // comment) — but a request row existing doesn't by itself mean
      // recordCharge ever finished; if a prior call created this row and
      // then failed before/during recordCharge, transactionId is still
      // null and this retry is exactly what closes that gap, rather than
      // returning a row whose charge was never recorded anywhere.
      if (!existing.transactionId) {
        await this.recordCharge(existing.id, existing.orgId, existing.amount!, razorpayOrderId, razorpayPaymentId);
        return this.prisma.assessmentRequest.findUniqueOrThrow({ where: { id: existing.id } });
      }
      return existing;
    }

    const order = await this.razorpay.fetchOrder(razorpayOrderId);
    const notes = (order.notes ?? {}) as unknown as Partial<OrderNotes>;
    if (!notes.orgId || !notes.candidateId || !notes.skillId || !notes.level || !notes.requestedByUserId) {
      throw new BadRequestException('Payment is missing its request context — cannot create the assessment request.');
    }
    // The order's own pinned context is authoritative; orgId is asserted
    // against the caller purely as a sanity check (JwtAuthGuard/OrgMemberGuard
    // already scope req.orgId), not the actual access-control boundary.
    if (notes.orgId !== orgId) {
      throw new ForbiddenException('This payment was not made by your organization.');
    }

    const paidAt = new Date();
    const chargedAmount = chargeAmountPaise();
    const request = await this.prisma.assessmentRequest.create({
      data: {
        orgId: notes.orgId,
        requestedByUserId: notes.requestedByUserId,
        candidateId: notes.candidateId,
        skillId: notes.skillId,
        level: notes.level as SkillLevel,
        status: AssessmentRequestStatus.PAID_PENDING_START,
        razorpayOrderId,
        razorpayPaymentId,
        amount: chargedAmount,
        paidAt,
        expiresAt: new Date(paidAt.getTime() + EXPIRY_WINDOW_MS),
      },
    });

    await this.recordCharge(request.id, notes.orgId, chargedAmount, razorpayOrderId, razorpayPaymentId);
    await this.notifyCandidateInvited(request.id);
    return request;
  }

  /**
   * Ledger + GST split for a just-verified charge — mirrors
   * RazorpayWebhookService.recordCharge's own posture (system-actor
   * Transaction, defensive totalPaise assertion) for the one-time-charge
   * side of the business. Runs synchronously inside verifyAndCreate, not
   * fire-and-forget: unlike a document (queued, retried independently —
   * see the `documents` module), the ledger entry for money that has
   * already left Razorpay must exist before this call returns, or a
   * successful charge could be recorded nowhere at all. A failure here
   * throws and the caller sees a 500 — the AssessmentRequest row itself
   * was already created and is idempotent on razorpayPaymentId (see this
   * method's own doc comment above), so a retried verify call is safe and
   * simply re-attempts recordCharge rather than double-creating anything.
   */
  private async recordCharge(
    requestId: string,
    orgId: string,
    chargedAmount: number,
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ): Promise<void> {
    // Deduped on providerPaymentId — same pattern as
    // RazorpayWebhookService.recordCharge — so two verify calls racing
    // before either has written transactionId back onto the
    // AssessmentRequest row (see this method's one caller) can never
    // create two Transaction rows for the same actual payment. Attaches
    // whichever transaction already exists rather than erroring, so the
    // loser of the race still ends up linked correctly.
    const existingTransaction = await this.prisma.transaction.findFirst({ where: { providerPaymentId: razorpayPaymentId } });
    if (existingTransaction) {
      await this.prisma.assessmentRequest.update({ where: { id: requestId }, data: { transactionId: existingTransaction.id } });
      return;
    }

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
      // misconfiguration (env var changed between order creation and
      // verify, or a stale client) fails loud rather than recording a
      // split that doesn't add up to what was actually charged.
      this.logger.error(
        `AssessmentRequest ${requestId}: computed GST total ${split.totalPaise} does not match actual charge ${chargedAmount} — recording amountPaise only, no tax split.`,
      );
    }

    const transaction = await this.transactions.recordSystemTransaction(billingProfileId, {
      amountPaise: chargedAmount,
      currency: CURRENCY,
      type: TransactionType.ASSESSMENT_REQUEST_PAYMENT,
      status: TransactionStatus.SUCCEEDED,
      description: 'MyAmbii assessment request charge',
      provider: 'razorpay',
      providerOrderId: razorpayOrderId,
      providerPaymentId: razorpayPaymentId,
      gst: split.totalPaise === chargedAmount ? split : undefined,
    });

    await this.prisma.assessmentRequest.update({ where: { id: requestId }, data: { transactionId: transaction.id } });
  }

  /**
   * Candidate-facing: start the assessment this request paid for. Atomic
   * conditional transition (updateMany WHERE status = PAID_PENDING_START
   * AND expiresAt > now) is what closes the start-vs-expiry race in both
   * directions — whichever of this call and the expiry job's own
   * conditional update actually flips the row first is the one that
   * "wins"; the loser's WHERE clause simply matches zero rows, so a
   * request can never end up both STARTED and refunded. A second call
   * after this one already won (double-click, page reload) matches zero
   * rows too, but for a different reason — see the reload below, which
   * treats "already STARTED with startedAt already set" as this same
   * candidate's already-started attempt/session and returns it rather than
   * erroring, mirroring AssessmentsService.startAttempt's own idempotent
   * pattern (never a double-start creating two attempts).
   */
  async startFromRequest(requestId: string, userId: string) {
    const request = await this.getOwnedByCandidate(requestId, userId);

    const { count } = await this.prisma.assessmentRequest.updateMany({
      where: { id: requestId, status: AssessmentRequestStatus.PAID_PENDING_START, expiresAt: { gt: new Date() } },
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
    return Promise.all(requests.map((r) => this.reconcile(r)));
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
