import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Transaction, TransactionStatus } from '@prisma/client';
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
  PENDING: [TransactionStatus.SUCCEEDED, TransactionStatus.FAILED],
  SUCCEEDED: [TransactionStatus.REFUNDED],
  FAILED: [],
  REFUNDED: [],
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
