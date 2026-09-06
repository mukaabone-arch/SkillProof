import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssessmentRequestStatus, BillingProfile, Document, DocumentSeries, DocumentStatus, Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';
import { GSTIN, SAC_CODE, SELLER_ADDRESS, SELLER_LEGAL_NAME } from '../../config/gst.config';
import { financialYearFor, formatDocumentNumber } from './document-numbering.util';
import { buildDocumentPdf, DocumentLineItem } from './document-pdf.builder';

/**
 * DocumentsGenerationJob's sweep stops retrying a PENDING document (numbered,
 * render/upload still failing) and flips it to FAILED_NEEDS_ATTENTION after
 * this many attempts — see DocumentStatus's own schema doc comment for what
 * happens from there (surfaced to a platform admin, never silently retried
 * forever). At an hourly sweep cadence this is ~5 hours before a human needs
 * to step in.
 */
export const MAX_GENERATION_ATTEMPTS = 5;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  /**
   * Every SUCCEEDED, GST-bearing Transaction with no Document yet — the one
   * query that drives both live generation and the backfill (see this
   * model's own doc comment on Transaction.document): there is no separate
   * "queue" table, a Transaction missing its Document IS the queue.
   * Oldest-first so numbering stays coherent with actual charge dates, both
   * for ordinary traffic and for the one-time backfill of pre-existing
   * charges.
   *
   * Excludes ASSESSMENT_REQUEST_ACCRUAL explicitly (2026-09, prepaid ->
   * postpaid switch) — that type is never SUCCEEDED at the point this
   * per-transaction sweep would otherwise pick it up anyway (it's written
   * PENDING at accrual, and only reaches SUCCEEDED once
   * AssessmentRequestInvoicingJob's monthly aggregation actually invoices
   * it — see reserveAndCreateForOrgPeriod below), but the exclusion is
   * still explicit rather than relying on that timing coincidence: an
   * accrual transaction must never get its own 1:1 document even if some
   * future change ever left one SUCCEEDED without going through the
   * monthly job first.
   */
  async findTransactionsNeedingDocuments(): Promise<{ id: string }[]> {
    return this.prisma.transaction.findMany({
      where: { status: 'SUCCEEDED', basePaise: { not: null }, documentId: null, type: { not: TransactionType.ASSESSMENT_REQUEST_ACCRUAL } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  /**
   * Every BillingProfile with at least one ASSESSMENT_REQUEST_ACCRUAL
   * transaction that's actually billable (its AssessmentRequest reached
   * STARTED or COMPLETED — see AssessmentRequestStatus's own doc comment
   * on why "started" is what earns the charge) and not yet invoiced
   * (status still PENDING, documentId still null). Deliberately not
   * filtered by a calendar-month window — see reserveAndCreateForOrgPeriod's
   * own doc comment for why "whatever is currently pending and billable"
   * is the correct query, not "whatever was created in the period just
   * ended": a request created near a period boundary that hasn't resolved
   * yet must never be invoiced before it's known to be billable, and this
   * query naturally excludes it (still ACCRUED_PENDING_START, not
   * STARTED/COMPLETED) until it resolves, at which point the next run
   * picks it up correctly regardless of which calendar month that is.
   *
   * The query itself is what guarantees an org with nothing accrued never
   * gets an invoice: an org with zero qualifying rows simply never appears
   * in this result, so reserveAndCreateForOrgPeriod (and the gap-free
   * numbering it reserves) is never invoked for them at all — not a
   * zero-check after the fact.
   */
  async findOrgsWithAccrualsNeedingInvoice(): Promise<{ billingProfileId: string }[]> {
    return this.prisma.transaction.findMany({
      where: {
        type: TransactionType.ASSESSMENT_REQUEST_ACCRUAL,
        status: TransactionStatus.PENDING,
        documentId: null,
        assessmentRequest: { status: { in: [AssessmentRequestStatus.STARTED, AssessmentRequestStatus.COMPLETED] } },
      },
      select: { billingProfileId: true },
      distinct: ['billingProfileId'],
    });
  }

  /** Every PENDING document (numbered, not yet GENERATED) still under the attempt cap — what the sweep's render phase retries. */
  async findPendingForRender(): Promise<{ id: string }[]> {
    return this.prisma.document.findMany({
      where: { status: DocumentStatus.PENDING, generationAttempts: { lt: MAX_GENERATION_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }

  /**
   * Phase 1 of generation — see Document's own doc comment for why this is
   * split from renderAndStore. Reserves the next sequence number for
   * (financialYear, series) and creates the Document row atomically with
   * that reservation (pg_advisory_xact_lock, transaction-scoped — see
   * DocumentSequence's own doc comment for why this and not a bare
   * Postgres SEQUENCE). Idempotent: if a Document already exists for this
   * transaction (a re-run after a partial failure elsewhere, or a race
   * with another sweep tick), returns the existing row rather than
   * reserving a second number for the same charge.
   *
   * One Transaction, one Document — the SUBSCRIPTION_CHARGE path (the only
   * type this is ever called for, per findTransactionsNeedingDocuments'
   * own exclusion — see reserveAndCreateForOrgPeriod below for the other
   * path). Shares its numbering core (claimNextDocumentNumber) with that
   * method rather than duplicating the advisory-lock/sequence-upsert logic.
   */
  async reserveAndCreate(transactionId: string): Promise<Document> {
    const owning = await this.prisma.transaction.findUnique({ where: { id: transactionId }, select: { documentId: true } });
    if (owning?.documentId) return this.prisma.document.findUniqueOrThrow({ where: { id: owning.documentId } });

    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) throw new NotFoundException(`Transaction ${transactionId} not found`);
    if (transaction.basePaise == null) {
      throw new Error(`reserveAndCreate: Transaction ${transactionId} has no GST split — not eligible for a document`);
    }

    const billingProfile = await this.prisma.billingProfile.findUniqueOrThrow({ where: { id: transaction.billingProfileId } });
    const series = billingProfile.gstin ? DocumentSeries.TAX_INVOICE : DocumentSeries.RECEIPT;
    const financialYear = financialYearFor(transaction.createdAt);
    const buyerAddress = formatBuyerAddress(billingProfile);

    return this.prisma.$transaction(async (tx) => {
      const { sequenceNumber, documentNumber } = await claimNextDocumentNumber(tx, financialYear, series);

      const document = await tx.document.create({
        data: {
          billingProfileId: transaction.billingProfileId,
          series,
          financialYear,
          sequenceNumber,
          documentNumber,
          basePaise: transaction.basePaise!,
          gstPaise: transaction.gstPaise!,
          cgstPaise: transaction.cgstPaise!,
          sgstPaise: transaction.sgstPaise!,
          igstPaise: transaction.igstPaise!,
          totalPaise: transaction.amountPaise,
          placeOfSupplyStateCode: transaction.placeOfSupplyStateCode!,
          sellerGstin: GSTIN,
          sellerLegalName: SELLER_LEGAL_NAME,
          sellerAddress: SELLER_ADDRESS,
          sacCode: SAC_CODE,
          buyerLegalName: billingProfile.legalEntityName,
          buyerGstin: billingProfile.gstin,
          buyerAddress,
          issuedAt: transaction.createdAt,
        },
      });
      await tx.transaction.update({ where: { id: transactionId }, data: { documentId: document.id } });
      return document;
    });
  }

  /**
   * The ASSESSMENT_REQUEST_ACCRUAL counterpart to reserveAndCreate — one
   * Document aggregating every currently-billable, not-yet-invoiced accrual
   * for one org (see findOrgsWithAccrualsNeedingInvoice's own doc comment
   * for the exact eligibility query and why it's safe against an org with
   * nothing to invoice). Idempotent the same way: if a caller re-runs this
   * for an org with nothing newly eligible (everything already has a
   * documentId), the qualifying-transaction query below simply returns
   * empty and this throws rather than reserving a number for zero line
   * items — see AssessmentRequestInvoicingJob, the only caller, which
   * already only calls this for orgs findOrgsWithAccrualsNeedingInvoice
   * just confirmed have at least one.
   *
   * series is unconditionally TAX_INVOICE — NOT the gstin-presence branch
   * reserveAndCreate uses — see DocumentSeries's own schema doc comment
   * for the two independent reasons: nothing has been received yet
   * (postpaid), and the buyer is always an Organization, never a B2C
   * consumer, regardless of whether its GSTIN has been entered.
   *
   * placeOfSupplyStateCode on the aggregate Document is cosmetic display
   * only — each covered Transaction's own cgstPaise/sgstPaise/igstPaise
   * was already correctly split against its OWN snapshot at accrual time
   * (see Transaction.placeOfSupplyStateCode's own doc comment), and this
   * method only ever sums those already-correct parts, never recomputes
   * the split at the aggregate level. If they disagree (an admin corrected
   * the org's gstStateCode mid-period), the most recent transaction's
   * value is used for display and a warning is logged — the summed tax
   * figures remain correct either way.
   */
  async reserveAndCreateForOrgPeriod(billingProfileId: string): Promise<Document> {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        billingProfileId,
        type: TransactionType.ASSESSMENT_REQUEST_ACCRUAL,
        status: TransactionStatus.PENDING,
        documentId: null,
        assessmentRequest: { status: { in: [AssessmentRequestStatus.STARTED, AssessmentRequestStatus.COMPLETED] } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (transactions.length === 0) {
      throw new Error(`reserveAndCreateForOrgPeriod: BillingProfile ${billingProfileId} has no billable, uninvoiced accruals`);
    }

    const billingProfile = await this.prisma.billingProfile.findUniqueOrThrow({ where: { id: billingProfileId } });
    const series = DocumentSeries.TAX_INVOICE;
    const issuedAt = new Date();
    const financialYear = financialYearFor(issuedAt);
    const buyerAddress = formatBuyerAddress(billingProfile);

    const distinctStateCodes = new Set(transactions.map((t) => t.placeOfSupplyStateCode));
    if (distinctStateCodes.size > 1) {
      this.logger.warn(
        `BillingProfile ${billingProfileId}: accruals being invoiced together have inconsistent placeOfSupplyStateCode values (${[...distinctStateCodes].join(', ')}) — using the most recent. Each transaction's own CGST/SGST/IGST split remains correct regardless.`,
      );
    }
    const placeOfSupplyStateCode = transactions[transactions.length - 1].placeOfSupplyStateCode ?? GSTIN;

    const sum = (field: 'basePaise' | 'gstPaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'amountPaise') =>
      transactions.reduce((total, t) => total + (t[field] ?? 0), 0);

    return this.prisma.$transaction(async (tx) => {
      const { sequenceNumber, documentNumber } = await claimNextDocumentNumber(tx, financialYear, series);

      const document = await tx.document.create({
        data: {
          billingProfileId,
          series,
          financialYear,
          sequenceNumber,
          documentNumber,
          basePaise: sum('basePaise'),
          gstPaise: sum('gstPaise'),
          cgstPaise: sum('cgstPaise'),
          sgstPaise: sum('sgstPaise'),
          igstPaise: sum('igstPaise'),
          totalPaise: sum('amountPaise'),
          placeOfSupplyStateCode,
          sellerGstin: GSTIN,
          sellerLegalName: SELLER_LEGAL_NAME,
          sellerAddress: SELLER_ADDRESS,
          sacCode: SAC_CODE,
          buyerLegalName: billingProfile.legalEntityName,
          buyerGstin: billingProfile.gstin,
          buyerAddress,
          issuedAt,
        },
      });

      await tx.transaction.updateMany({
        where: { id: { in: transactions.map((t) => t.id) } },
        data: { documentId: document.id, status: TransactionStatus.SUCCEEDED },
      });

      return document;
    });
  }

  /**
   * Phase 2 of generation — renders the PDF and uploads it to S3, against
   * an already-numbered row (see Document's own doc comment). Not
   * transactional with anything: a failure here never re-reserves a
   * number, it just leaves this row PENDING for the next sweep tick to
   * retry, up to MAX_GENERATION_ATTEMPTS.
   */
  async renderAndStore(documentId: string): Promise<void> {
    const document = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    if (document.status !== DocumentStatus.PENDING) return; // already GENERATED or FAILED_NEEDS_ATTENTION — nothing to do

    try {
      // One row for a SUBSCRIPTION_CHARGE document (still 1:1 in practice —
      // see Transaction.documentId's own doc comment); one row per covered
      // accrual for an ASSESSMENT_REQUEST_ACCRUAL invoice, each named from
      // its own AssessmentRequest (skill/level/candidate) rather than the
      // Transaction's own generic description, since that's what actually
      // distinguishes one line item from another on a multi-line invoice.
      const transactions = await this.prisma.transaction.findMany({
        where: { documentId: document.id },
        orderBy: { createdAt: 'asc' },
        include: { assessmentRequest: { include: { skill: true, candidateProfile: true } } },
      });
      const lineItems: DocumentLineItem[] = transactions.map((t) => ({
        description: t.assessmentRequest
          ? `${t.assessmentRequest.skill.name} ${t.assessmentRequest.level} assessment — ${t.assessmentRequest.candidateProfile.fullName ?? 'candidate'}`
          : (t.description ?? 'MyAmbii charge'),
        basePaise: t.basePaise ?? 0,
      }));

      const pdf = await buildDocumentPdf({
        series: document.series,
        documentNumber: document.documentNumber,
        issuedAt: document.issuedAt,
        lineItems,
        sellerLegalName: document.sellerLegalName,
        sellerAddress: document.sellerAddress,
        sellerGstin: document.sellerGstin,
        sacCode: document.sacCode,
        buyerLegalName: document.buyerLegalName,
        buyerGstin: document.buyerGstin,
        buyerAddress: document.buyerAddress,
        basePaise: document.basePaise,
        cgstPaise: document.cgstPaise,
        sgstPaise: document.sgstPaise,
        igstPaise: document.igstPaise,
        totalPaise: document.totalPaise,
        placeOfSupplyStateCode: document.placeOfSupplyStateCode,
      });

      const fileKey = `documents/${document.id}.pdf`;
      await this.storage.write(fileKey, pdf, 'application/pdf');

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DocumentStatus.GENERATED, fileKey, generatedAt: new Date(), lastGenerationError: null },
      });
    } catch (err) {
      const attempts = document.generationAttempts + 1;
      const nextStatus = attempts >= MAX_GENERATION_ATTEMPTS ? DocumentStatus.FAILED_NEEDS_ATTENTION : DocumentStatus.PENDING;
      const message = (err as Error).message;
      await this.prisma.document.update({
        where: { id: documentId },
        data: { generationAttempts: attempts, lastGenerationError: message, status: nextStatus },
      });
      this.logger.error(
        `renderAndStore failed for Document ${documentId} (attempt ${attempts}/${MAX_GENERATION_ATTEMPTS}): ${message}` +
          (nextStatus === DocumentStatus.FAILED_NEEDS_ATTENTION ? ' — exhausted retries, needs admin attention' : ''),
      );
    }
  }

  /** Every document issued against one BillingProfile, most recent first. */
  async listForBillingProfile(billingProfileId: string): Promise<Document[]> {
    return this.prisma.document.findMany({ where: { billingProfileId }, orderBy: { issuedAt: 'desc' } });
  }

  /** A candidate's own documents — empty (not an error) if they have no BillingProfile yet, e.g. never subscribed. */
  async listForCandidateUser(userId: string): Promise<Document[]> {
    const candidate = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!candidate) return [];
    return this.prisma.document.findMany({ where: { billingProfile: { candidateId: candidate.id } }, orderBy: { issuedAt: 'desc' } });
  }

  /** An org's own documents — empty until it has a BillingProfile with at least one GST-bearing charge. */
  async listForOrg(organizationId: string): Promise<Document[]> {
    return this.prisma.document.findMany({ where: { billingProfile: { organizationId } }, orderBy: { issuedAt: 'desc' } });
  }

  /** Ownership-checked lookup for a candidate — 404s rather than 403s on a document that isn't theirs, same "don't confirm existence" posture as every other owned-resource lookup in this codebase. */
  async getOwnedByCandidateUser(userId: string, documentId: string): Promise<Document> {
    const candidate = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    const document = candidate
      ? await this.prisma.document.findFirst({ where: { id: documentId, billingProfile: { candidateId: candidate.id } } })
      : null;
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  /** Same as getOwnedByCandidateUser, org-scoped — for the employer side's assessment-request invoices. */
  async getOwnedByOrg(orgId: string, documentId: string): Promise<Document> {
    const document = await this.prisma.document.findFirst({ where: { id: documentId, billingProfile: { organizationId: orgId } } });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  /** A short-lived, scoped download URL — never a public object (see S3StorageService's own doc comment). 409s on a document that's numbered but not yet rendered/stored, rather than 404ing something that does exist. */
  async getDownloadUrl(document: Document): Promise<string> {
    if (document.status !== DocumentStatus.GENERATED || !document.fileKey) {
      throw new ConflictException(
        document.status === DocumentStatus.FAILED_NEEDS_ATTENTION
          ? 'This document failed to generate and is pending attention — it is not yet available.'
          : 'This document has been numbered but is not ready for download yet.',
      );
    }
    const filename = `${document.documentNumber.replace(/\//g, '-')}.pdf`;
    return this.storage.getPresignedDownloadUrl(document.fileKey, { filename });
  }

  // ---------- Admin ----------

  async listForAdmin(status?: DocumentStatus): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Resets a FAILED_NEEDS_ATTENTION document back to PENDING with a clean
   * attempt count, for the next sweep tick to pick up — used once a
   * platform admin has actually fixed whatever was failing (an S3 outage,
   * bad snapshot data, etc.). Only valid from FAILED_NEEDS_ATTENTION — a
   * document that's already GENERATED, or still ordinarily PENDING and
   * retrying on its own, has nothing to "retry" in the admin-intervention
   * sense.
   */
  async retry(documentId: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException('Document not found');
    if (document.status !== DocumentStatus.FAILED_NEEDS_ATTENTION) {
      throw new ConflictException(`Only a document in FAILED_NEEDS_ATTENTION can be retried (this one is ${document.status}).`);
    }
    return this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.PENDING, generationAttempts: 0, lastGenerationError: null },
    });
  }
}

/** Joins whichever of addressLine1/addressLine2/city/state/postalCode a BillingProfile actually has on file — null (not an empty string) when none of them are set, since a RECEIPT frequently has no buyer address at all (see Document.buyerAddress's own schema doc comment on why that's correct, not a gap). */
function formatBuyerAddress(profile: Pick<BillingProfile, 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode'>): string | null {
  const parts = [profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.postalCode].filter(
    (p): p is string => !!p && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * The gap-free numbering core shared by reserveAndCreate (one Transaction)
 * and reserveAndCreateForOrgPeriod (many) — factored out specifically so
 * the advisory-lock/sequence-upsert logic exists in exactly one place
 * regardless of which caller reserves a number. Must be called with an
 * already-open Prisma `$transaction` client (`tx`), never `this.prisma`
 * directly — the caller's own transaction is what makes the lock,
 * increment, and the Document row it numbers commit or roll back together
 * (see DocumentSequence's own doc comment).
 */
async function claimNextDocumentNumber(
  tx: Prisma.TransactionClient,
  financialYear: string,
  series: DocumentSeries,
): Promise<{ sequenceNumber: number; documentNumber: string }> {
  // Transaction-scoped advisory lock — released automatically on commit OR
  // rollback, serializing concurrent reservations for the same
  // (financialYear, series) pair without a second SELECT...FOR UPDATE on
  // DocumentSequence (see that model's own doc comment).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${financialYear}:${series}`}))`;

  const sequence = await tx.documentSequence.upsert({
    where: { financialYear_series: { financialYear, series } },
    create: { financialYear, series, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
  });

  return { sequenceNumber: sequence.lastNumber, documentNumber: formatDocumentNumber(series, financialYear, sequence.lastNumber) };
}
