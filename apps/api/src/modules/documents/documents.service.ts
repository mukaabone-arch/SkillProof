import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BillingProfile, Document, DocumentSeries, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';
import { GSTIN, SAC_CODE, SELLER_ADDRESS, SELLER_LEGAL_NAME } from '../../config/gst.config';
import { financialYearFor, formatDocumentNumber } from './document-numbering.util';
import { buildDocumentPdf } from './document-pdf.builder';

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
   */
  async findTransactionsNeedingDocuments(): Promise<{ id: string }[]> {
    return this.prisma.transaction.findMany({
      where: { status: 'SUCCEEDED', basePaise: { not: null }, document: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
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
   */
  async reserveAndCreate(transactionId: string): Promise<Document> {
    const existing = await this.prisma.document.findUnique({ where: { transactionId } });
    if (existing) return existing;

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
      // Transaction-scoped advisory lock — released automatically on
      // commit OR rollback, serializing concurrent reservations for the
      // same (financialYear, series) pair without a second SELECT...FOR
      // UPDATE on DocumentSequence (see that model's own doc comment).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${financialYear}:${series}`}))`;

      const sequence = await tx.documentSequence.upsert({
        where: { financialYear_series: { financialYear, series } },
        create: { financialYear, series, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });

      return tx.document.create({
        data: {
          transactionId,
          billingProfileId: transaction.billingProfileId,
          series,
          financialYear,
          sequenceNumber: sequence.lastNumber,
          documentNumber: formatDocumentNumber(series, financialYear, sequence.lastNumber),
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
      const transaction = await this.prisma.transaction.findUniqueOrThrow({ where: { id: document.transactionId } });
      const pdf = await buildDocumentPdf({
        series: document.series,
        documentNumber: document.documentNumber,
        issuedAt: document.issuedAt,
        description: transaction.description ?? 'MyAmbii charge',
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

  /** Same as getOwnedByCandidateUser, org-scoped — for the employer side once assessment-request documents exist. */
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
