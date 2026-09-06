import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Transaction, TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AmendTransactionDto, AttachProviderReferenceDto, CreateTransactionDto } from './billing.dto';

/**
 * Valid forward-only status transitions — see Transaction's own schema doc
 * comment. Anything not listed here (backwards, sideways, or arbitrary)
 * 409s. PENDING is the only entry state a transition can start from, other
 * than the terminal-from-the-start states (FAILED, REFUNDED) which have no
 * outgoing transitions at all.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  PENDING: [TransactionStatus.SUCCEEDED, TransactionStatus.FAILED, TransactionStatus.VOIDED],
  SUCCEEDED: [TransactionStatus.REFUNDED],
  FAILED: [],
  REFUNDED: [],
  VOIDED: [],
};

/**
 * Admin access to the append-only Transaction ledger — see Transaction's
 * own schema doc comment for the immutability contract this service exists
 * to enforce: amountPaise/currency/type are never touched by any method
 * here after creation (a correction is always a new row via amend()), and
 * status only ever moves through transitionStatus's state machine, never a
 * bare field write. Every method logs through AdminAccessLog, resolving
 * the owning candidate/org from the transaction's own BillingProfile so
 * org-owned transactions get the same first-class logging candidate-owned
 * ones do (see AdminAccessLog.organizationId's own doc comment).
 */
@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listForProfile(billingProfileId: string) {
    return this.prisma.transaction.findMany({
      where: { billingProfileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(adminUserId: string, billingProfileId: string, dto: CreateTransactionDto) {
    const profile = await this.prisma.billingProfile.findUnique({ where: { id: billingProfileId } });
    if (!profile || profile.deletedAt) throw new NotFoundException('Billing profile not found');

    const transaction = await this.prisma.transaction.create({
      data: {
        billingProfileId,
        amountPaise: dto.amountPaise,
        currency: dto.currency ?? 'INR',
        type: dto.type,
        status: dto.status,
        description: dto.description,
        createdByAdminId: adminUserId,
      },
    });

    await this.logAdminAccess(adminUserId, 'CREATE_TRANSACTION', transaction.id, profile.candidateId, profile.organizationId);
    return transaction;
  }

  /**
   * The only path that corrects amountPaise/currency/type on an existing
   * transaction — never in place. Creates a brand-new row carrying its own
   * financial core, linked back to what it corrects via
   * amendsTransactionId. The original row is never written to here.
   */
  async amend(adminUserId: string, originalId: string, dto: AmendTransactionDto) {
    const original = await this.getOwned(originalId);

    const amendment = await this.prisma.transaction.create({
      data: {
        billingProfileId: original.billingProfileId,
        amountPaise: dto.amountPaise,
        currency: dto.currency ?? 'INR',
        type: dto.type,
        status: dto.status,
        description: dto.description,
        createdByAdminId: adminUserId,
        amendsTransactionId: original.id,
      },
    });

    await this.logAdminAccess(
      adminUserId,
      'AMEND_TRANSACTION',
      amendment.id,
      original.billingProfile.candidateId,
      original.billingProfile.organizationId,
    );
    return amendment;
  }

  /**
   * The only path that changes status post-creation — enforces
   * ALLOWED_STATUS_TRANSITIONS strictly; anything else 409s rather than
   * silently no-opping or coercing. Never touches amountPaise/currency/type.
   */
  async transitionStatus(adminUserId: string, id: string, nextStatus: TransactionStatus) {
    const transaction = await this.getOwned(id);

    const allowed = ALLOWED_STATUS_TRANSITIONS[transaction.status];
    if (!allowed.includes(nextStatus)) {
      throw new ConflictException(
        `Cannot transition a transaction from ${transaction.status} to ${nextStatus}. Allowed from ${transaction.status}: ${allowed.length ? allowed.join(', ') : 'none (terminal)'}.`,
      );
    }

    const updated = await this.prisma.transaction.update({ where: { id }, data: { status: nextStatus } });
    await this.logAdminAccess(
      adminUserId,
      `TRANSITION_TRANSACTION_STATUS_${transaction.status}_TO_${nextStatus}`,
      id,
      transaction.billingProfile.candidateId,
      transaction.billingProfile.organizationId,
    );
    return updated;
  }

  /**
   * Fills provider/providerOrderId/providerPaymentId — the one narrow
   * exception to immutability (see Transaction's own doc comment).
   * Null -> value only: a provider reference already set can never be
   * overwritten here, only attached once. Reconciliation metadata, not a
   * correction to the financial facts, so this deliberately does not go
   * through amend().
   */
  async attachProviderReference(adminUserId: string, id: string, dto: AttachProviderReferenceDto) {
    const transaction = await this.getOwned(id);

    if (transaction.provider || transaction.providerOrderId || transaction.providerPaymentId) {
      throw new ConflictException('This transaction already has a provider reference attached — it cannot be overwritten.');
    }

    const updated = await this.prisma.transaction.update({
      where: { id },
      data: {
        provider: dto.provider,
        providerOrderId: dto.providerOrderId,
        providerPaymentId: dto.providerPaymentId,
      },
    });
    await this.logAdminAccess(
      adminUserId,
      'ATTACH_TRANSACTION_PROVIDER_REFERENCE',
      id,
      transaction.billingProfile.candidateId,
      transaction.billingProfile.organizationId,
    );
    return updated;
  }

  /**
   * The one path allowed to write createdByAdminId: null — a Transaction
   * whose actor is a system process, not a human admin. Two callers:
   * RazorpayWebhookService (subscription charges) and
   * AssessmentRequestsService.create (assessment-request accruals,
   * written the instant a request is created — postpaid, 2026-09; no
   * longer keyed on a Razorpay payment id) — see Transaction.
   * createdByAdminId's own schema doc comment for why this is a dedicated
   * method rather than widening create()/attachProviderReference() to
   * accept a nullable admin id: every admin-facing method on this service
   * keeps requiring a real adminUserId, unchanged. No AdminAccessLog write
   * here — there is no admin action to log; RazorpayWebhookEvent (for the
   * subscription path) or the AssessmentRequest row itself (for the other)
   * is each caller's own audit trail instead. Callers are responsible for
   * their own idempotency check before calling this.
   */
  async recordSystemTransaction(
    billingProfileId: string,
    data: {
      amountPaise: number;
      currency?: string;
      type: TransactionType;
      status: TransactionStatus;
      description?: string;
      /**
       * Optional (unlike the historical Razorpay-only shape) — an
       * ASSESSMENT_REQUEST_ACCRUAL transaction has no payment provider at
       * all when this is written, since it's recorded at accrual, before
       * any money moves (postpaid — see AssessmentRequestsService.create).
       * Left null for that caller; still required in spirit for
       * RazorpayWebhookService's subscription-charge path, which always
       * passes 'razorpay'.
       */
      provider?: string;
      providerOrderId?: string | null;
      providerPaymentId?: string | null;
      /**
       * GST breakdown — all five present together, or omit the whole
       * object (see Transaction.basePaise's own schema comment on why
       * this is never a partial set). Caller is responsible for the two
       * invariants this doesn't re-derive: basePaise + gstPaise ===
       * amountPaise, and gstPaise === cgstPaise + sgstPaise + igstPaise —
       * both guaranteed by construction if gst.config.ts's splitGst
       * produced this object, so the only real requirement is "don't hand
       * this a hand-built one that skips splitGst."
       */
      gst?: {
        basePaise: number;
        gstPaise: number;
        cgstPaise: number;
        sgstPaise: number;
        igstPaise: number;
        placeOfSupplyStateCode: string;
      };
    },
  ): Promise<Transaction> {
    if (data.gst && data.gst.basePaise + data.gst.gstPaise !== data.amountPaise) {
      // Defensive, not expected to ever fire in practice — both callers
      // (RazorpayWebhookService.recordCharge, AssessmentRequestsService.
      // create) always build `gst` from splitGst(basePaise, ...) against
      // the exact same amountPaise they pass here, which is what
      // guarantees this by construction. Catches a future caller wiring
      // these up inconsistently rather than silently recording a ledger
      // row whose parts don't sum to its own total.
      throw new Error(
        `recordSystemTransaction: gst.basePaise + gst.gstPaise (${data.gst.basePaise + data.gst.gstPaise}) !== amountPaise (${data.amountPaise})`,
      );
    }

    return this.prisma.transaction.create({
      data: {
        billingProfileId,
        amountPaise: data.amountPaise,
        currency: data.currency ?? 'INR',
        type: data.type,
        status: data.status,
        description: data.description,
        createdByAdminId: null,
        provider: data.provider ?? null,
        providerOrderId: data.providerOrderId ?? null,
        providerPaymentId: data.providerPaymentId ?? null,
        basePaise: data.gst?.basePaise ?? null,
        gstPaise: data.gst?.gstPaise ?? null,
        cgstPaise: data.gst?.cgstPaise ?? null,
        sgstPaise: data.gst?.sgstPaise ?? null,
        igstPaise: data.gst?.igstPaise ?? null,
        placeOfSupplyStateCode: data.gst?.placeOfSupplyStateCode ?? null,
      },
    });
  }

  /**
   * The system-actor counterpart to transitionStatus — SUCCEEDED ->
   * REFUNDED with no human admin behind the write, same
   * createdByAdminId-null-path posture as recordSystemTransaction above.
   * Used by AssessmentRequestsRefundJob once Razorpay's own refund call
   * has actually succeeded: that job's own row (AssessmentRequest.status
   * EXPIRED_REFUNDED + razorpayRefundId) is its audit trail, so no
   * AdminAccessLog write here either. Still goes through
   * ALLOWED_STATUS_TRANSITIONS like every other status change — a
   * transaction not currently SUCCEEDED can't be refunded twice.
   */
  async recordSystemRefund(transactionId: string): Promise<Transaction> {
    const transaction = await this.getOwned(transactionId);

    const allowed = ALLOWED_STATUS_TRANSITIONS[transaction.status];
    if (!allowed.includes(TransactionStatus.REFUNDED)) {
      throw new ConflictException(
        `Cannot transition a transaction from ${transaction.status} to REFUNDED. Allowed from ${transaction.status}: ${allowed.length ? allowed.join(', ') : 'none (terminal)'}.`,
      );
    }

    return this.prisma.transaction.update({ where: { id: transactionId }, data: { status: TransactionStatus.REFUNDED } });
  }

  /**
   * The system-actor counterpart to transitionStatus for the other terminal
   * PENDING transition — PENDING -> VOIDED, no human admin behind the
   * write, same posture as recordSystemRefund above. Used by
   * AssessmentRequestExpiryJob (and AccountService, on candidate
   * deactivation/deletion) when an ASSESSMENT_REQUEST_ACCRUAL transaction's
   * request expired without the candidate ever starting it — that
   * AssessmentRequest's own status (EXPIRED_UNBILLED) is the audit trail,
   * so no AdminAccessLog write here either. Unlike a refund, voiding never
   * calls an external payment provider — it's a pure local status write —
   * so there is no "the void attempt itself failed" case symmetric to
   * REFUND_FAILED; this either succeeds or the transaction genuinely
   * wasn't PENDING (already invoiced, or already voided).
   */
  async recordSystemVoid(transactionId: string): Promise<Transaction> {
    const transaction = await this.getOwned(transactionId);

    const allowed = ALLOWED_STATUS_TRANSITIONS[transaction.status];
    if (!allowed.includes(TransactionStatus.VOIDED)) {
      throw new ConflictException(
        `Cannot transition a transaction from ${transaction.status} to VOIDED. Allowed from ${transaction.status}: ${allowed.length ? allowed.join(', ') : 'none (terminal)'}.`,
      );
    }

    return this.prisma.transaction.update({ where: { id: transactionId }, data: { status: TransactionStatus.VOIDED } });
  }

  private async getOwned(id: string): Promise<Transaction & { billingProfile: { candidateId: string | null; organizationId: string | null } }> {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: { billingProfile: { select: { candidateId: true, organizationId: true } } },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');
    return transaction;
  }

  private async logAdminAccess(
    adminUserId: string,
    action: string,
    targetId: string,
    candidateProfileId: string | null,
    organizationId: string | null,
  ): Promise<void> {
    try {
      await this.prisma.adminAccessLog.create({
        data: { adminUserId, action, targetType: 'Transaction', targetId, candidateProfileId, organizationId },
      });
    } catch (err) {
      this.logger.error(`Failed to write AdminAccessLog for ${action}: ${(err as Error).message}`);
    }
  }
}
