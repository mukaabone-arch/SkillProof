import { DocumentSeries, DocumentStatus } from '@prisma/client';
import { DocumentsService, MAX_GENERATION_ATTEMPTS } from './documents.service';
import { SAC_CODE } from '../../config/gst.config';

function fakePrisma() {
  const documents: any[] = [];
  const sequences: any[] = [];
  const transactions: any[] = [
    {
      id: 'txn-receipt',
      billingProfileId: 'bp-candidate',
      status: 'SUCCEEDED',
      basePaise: 29900,
      gstPaise: 5382,
      cgstPaise: 2691,
      sgstPaise: 2691,
      igstPaise: 0,
      amountPaise: 35282,
      placeOfSupplyStateCode: '27',
      createdAt: new Date('2026-08-31T06:20:41.000Z'),
      description: 'MyAmbii Premium subscription charge',
    },
    {
      id: 'txn-invoice',
      billingProfileId: 'bp-org',
      status: 'SUCCEEDED',
      basePaise: 15000,
      gstPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2700,
      amountPaise: 17700,
      placeOfSupplyStateCode: '29',
      createdAt: new Date('2026-08-31T06:20:41.000Z'),
      description: 'MyAmbii assessment request charge',
    },
    {
      id: 'txn-no-gst',
      billingProfileId: 'bp-candidate',
      status: 'SUCCEEDED',
      basePaise: null,
      amountPaise: 50000,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      description: 'Pre-GST charge',
    },
    // Monthly-invoicing fixtures — ASSESSMENT_REQUEST_ACCRUAL transactions,
    // each linked to an AssessmentRequest via assessmentRequestId (fake
    // relation, resolved manually below since this is a hand-rolled mock,
    // not a real join).
    {
      id: 'txn-accrual-started-1',
      billingProfileId: 'bp-org',
      type: 'ASSESSMENT_REQUEST_ACCRUAL',
      status: 'PENDING',
      documentId: null,
      basePaise: 15000,
      gstPaise: 2700,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2700,
      amountPaise: 17700,
      placeOfSupplyStateCode: '29',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      description: 'MyAmbii assessment request charge',
      assessmentRequestId: 'areq-started-1',
    },
    {
      id: 'txn-accrual-started-2',
      billingProfileId: 'bp-org',
      type: 'ASSESSMENT_REQUEST_ACCRUAL',
      status: 'PENDING',
      documentId: null,
      basePaise: 15000,
      gstPaise: 2700,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2700,
      amountPaise: 17700,
      placeOfSupplyStateCode: '29',
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
      description: 'MyAmbii assessment request charge',
      assessmentRequestId: 'areq-started-2',
    },
    {
      id: 'txn-accrual-unresolved',
      billingProfileId: 'bp-org',
      type: 'ASSESSMENT_REQUEST_ACCRUAL',
      status: 'PENDING',
      documentId: null,
      basePaise: 15000,
      gstPaise: 2700,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2700,
      amountPaise: 17700,
      placeOfSupplyStateCode: '29',
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
      description: 'MyAmbii assessment request charge',
      assessmentRequestId: 'areq-unresolved', // still ACCRUED_PENDING_START — must never be invoiced
    },
    {
      id: 'txn-accrual-excluded',
      billingProfileId: 'bp-org-2',
      type: 'ASSESSMENT_REQUEST_ACCRUAL',
      status: 'PENDING',
      documentId: null,
      basePaise: 15000,
      gstPaise: 2700,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2700,
      amountPaise: 17700,
      placeOfSupplyStateCode: '29',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      description: 'MyAmbii assessment request charge',
      assessmentRequestId: 'areq-excluded', // EXPIRED_UNBILLED — must never count toward whether bp-org-2 needs an invoice
    },
    {
      // Only real billable accrual for bp-org-2 — a gstin-less org (see its
      // BillingProfile fixture) proving the series is TAX_INVOICE
      // regardless.
      id: 'txn-accrual-org2-started',
      billingProfileId: 'bp-org-2',
      type: 'ASSESSMENT_REQUEST_ACCRUAL',
      status: 'PENDING',
      documentId: null,
      basePaise: 15000,
      gstPaise: 2700,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 2700,
      amountPaise: 17700,
      placeOfSupplyStateCode: '29',
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
      description: 'MyAmbii assessment request charge',
      assessmentRequestId: 'areq-org2-started',
    },
  ];
  const assessmentRequests: any[] = [
    { id: 'areq-started-1', status: 'STARTED', skillId: 'skill-1', candidateId: 'candidate-1' },
    { id: 'areq-started-2', status: 'COMPLETED', skillId: 'skill-2', candidateId: 'candidate-2' },
    { id: 'areq-unresolved', status: 'ACCRUED_PENDING_START', skillId: 'skill-1', candidateId: 'candidate-1' },
    { id: 'areq-excluded', status: 'EXPIRED_UNBILLED', skillId: 'skill-1', candidateId: 'candidate-1' },
    { id: 'areq-org2-started', status: 'STARTED', skillId: 'skill-1', candidateId: 'candidate-1' },
  ];
  const skills: any[] = [
    { id: 'skill-1', name: 'LLM Evaluation' },
    { id: 'skill-2', name: 'RAG Systems' },
  ];
  const billingProfiles: any[] = [
    {
      id: 'bp-candidate',
      legalEntityName: 'Jordan Lee',
      gstin: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
    },
    {
      id: 'bp-org',
      legalEntityName: 'Acme Inc',
      gstin: '29AAACT2727Q1ZM',
      addressLine1: '1st Floor, MG Road',
      addressLine2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
    },
    {
      // Deliberately NO gstin — an org that hasn't had an admin fill this in
      // yet (see AssessmentRequestBillingProfileService.
      // ensureMinimalBillingProfile). Its assessment-request invoice must
      // still be TAX_INVOICE, never RECEIPT — see reserveAndCreateForOrgPeriod's
      // own tests below.
      id: 'bp-org-2',
      legalEntityName: 'Beta LLC',
      gstin: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
    },
  ];
  const candidateProfiles: any[] = [{ id: 'candidate-1', userId: 'user-candidate-1' }];

  const documentModel = {
    findUnique: jest.fn(async ({ where }: any) => documents.find((d) => d.id === where.id) ?? null),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const row = documents.find((d) => d.id === where.id);
      if (!row) throw new Error('not found');
      return row;
    }),
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        documents.find((d) => {
          if (where.id && d.id !== where.id) return false;
          const bp = billingProfiles.find((b) => b.id === d.billingProfileId);
          if (where.billingProfile?.candidateId && bp?.candidateId !== where.billingProfile.candidateId) return false;
          if (where.billingProfile?.organizationId && bp?.organizationId !== where.billingProfile.organizationId) return false;
          return true;
        }) ?? null
      );
    }),
    findMany: jest.fn(async ({ where }: any = {}) => {
      return documents.filter((d) => {
        if (where?.status && d.status !== where.status) return false;
        if (where?.generationAttempts?.lt != null && !(d.generationAttempts < where.generationAttempts.lt)) return false;
        if (where?.billingProfileId && d.billingProfileId !== where.billingProfileId) return false;
        return true;
      });
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `doc-${documents.length + 1}`, status: DocumentStatus.PENDING, generationAttempts: 0, createdAt: new Date(), ...data };
      documents.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = documents.find((d) => d.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  };

  const documentSequenceModel = {
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const key = `${where.financialYear_series.financialYear}:${where.financialYear_series.series}`;
      let row = sequences.find((s) => `${s.financialYear}:${s.series}` === key);
      if (!row) {
        row = { financialYear: create.financialYear, series: create.series, lastNumber: create.lastNumber };
        sequences.push(row);
      } else {
        row.lastNumber += update.lastNumber.increment;
      }
      return row;
    }),
  };

  const prisma: any = {
    _documents: documents,
    _sequences: sequences,
    _transactions: transactions,
    document: documentModel,
    documentSequence: documentSequenceModel,
    transaction: {
      findUnique: jest.fn(async ({ where }: any) => transactions.find((t) => t.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const row = transactions.find((t) => t.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = transactions.find((t) => t.id === where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        const matched = transactions.filter((t) => ids.includes(t.id));
        for (const t of matched) Object.assign(t, data);
        return { count: matched.length };
      }),
      // Minimal join emulation for the assessmentRequest relation filter —
      // real Prisma resolves this via SQL; here it's a manual lookup
      // against the assessmentRequests fixture keyed by
      // transaction.assessmentRequestId.
      findMany: jest.fn(async ({ where, select, distinct, orderBy }: any = {}) => {
        let rows = transactions.filter((t) => {
          if (where?.billingProfileId && t.billingProfileId !== where.billingProfileId) return false;
          if (where?.type && t.type !== where.type) return false;
          if (where?.status && t.status !== where.status) return false;
          if ('documentId' in (where ?? {}) && where.documentId === null && t.documentId != null) return false;
          const statusIn = where?.assessmentRequest?.status?.in as string[] | undefined;
          if (statusIn) {
            const areq = assessmentRequests.find((a) => a.id === t.assessmentRequestId);
            if (!areq || !statusIn.includes(areq.status)) return false;
          }
          return true;
        });
        if (orderBy?.createdAt === 'asc') rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (distinct) {
          const seen = new Set<string>();
          rows = rows.filter((r) => {
            const key = distinct.map((f: string) => r[f]).join(':');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        if (select) {
          return rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])));
        }
        return rows;
      }),
    },
    billingProfile: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const row = billingProfiles.find((b) => b.id === where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
    },
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: any) => candidateProfiles.find((c) => c.userId === where.userId) ?? null),
    },
    $transaction: jest.fn(async (callback: any) => {
      const tx = { ...prisma, $executeRaw: jest.fn(async () => undefined) };
      return callback(tx);
    }),
  };

  return prisma;
}

function fakeStorage() {
  return {
    write: jest.fn(async () => undefined),
    read: jest.fn(async () => Buffer.from('')),
    delete: jest.fn(async () => undefined),
    getPresignedDownloadUrl: jest.fn(async () => 'https://s3.example.com/presigned-url'),
  };
}

describe('DocumentsService', () => {
  describe('reserveAndCreate', () => {
    it('classifies a BillingProfile with no gstin as RECEIPT and numbers it INV.../RCT... correctly', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreate('txn-receipt');

      expect(doc.series).toBe(DocumentSeries.RECEIPT);
      expect(doc.documentNumber).toBe('RCT/2026-27/000001');
      expect(doc.sequenceNumber).toBe(1);
      expect(doc.buyerGstin).toBeNull();
      expect(doc.buyerAddress).toBeNull(); // no address on file — correct, not a gap (see BillingProfile fixture)
    });

    it('classifies a BillingProfile with a gstin as TAX_INVOICE and snapshots buyer GSTIN/address', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreate('txn-invoice');

      expect(doc.series).toBe(DocumentSeries.TAX_INVOICE);
      expect(doc.documentNumber).toBe('INV/2026-27/000001');
      expect(doc.buyerGstin).toBe('29AAACT2727Q1ZM');
      expect(doc.buyerAddress).toBe('1st Floor, MG Road, Bengaluru, Karnataka, 560001');
    });

    it('snapshots the seller identity from gst.config.ts, not a live reference', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreate('txn-receipt');

      expect(doc.sellerGstin).toBe('27AAUCM4131F1ZC');
      expect(doc.sellerLegalName).toBe('Mukaab Technologies Private Limited');
      expect(doc.sacCode).toBe(SAC_CODE);
    });

    it('two documents in the same (financialYear, series) get sequential numbers, not the same one', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const first = await service.reserveAndCreate('txn-receipt');
      // A second GST-bearing charge on the same billing profile/series (e.g.
      // a renewal) — clone the fixture under a new transaction id, pushed
      // into the same backing array reserveAndCreate's own transaction.update
      // call needs to find and mutate (documentId gets attached to it).
      prisma._transactions.push({
        id: 'txn-receipt-clone',
        billingProfileId: 'bp-candidate',
        status: 'SUCCEEDED',
        basePaise: 29900,
        gstPaise: 5382,
        cgstPaise: 2691,
        sgstPaise: 2691,
        igstPaise: 0,
        amountPaise: 35282,
        placeOfSupplyStateCode: '27',
        createdAt: new Date('2026-09-15T00:00:00.000Z'),
        description: 'Renewal',
      });
      const second = await service.reserveAndCreate('txn-receipt-clone');

      expect(first.sequenceNumber).toBe(1);
      expect(second.sequenceNumber).toBe(2);
      expect(second.documentNumber).toBe('RCT/2026-27/000002');
    });

    it('is idempotent — a second call for the same transaction returns the existing document, never a second number', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const first = await service.reserveAndCreate('txn-receipt');
      const second = await service.reserveAndCreate('txn-receipt');

      expect(second.id).toBe(first.id);
      expect(prisma._documents).toHaveLength(1);
      expect(prisma.documentSequence.upsert).toHaveBeenCalledTimes(1);
    });

    it('refuses a Transaction with no GST split — never fabricates a document for an untaxed charge', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      await expect(service.reserveAndCreate('txn-no-gst')).rejects.toThrow(/no GST split/);
      expect(prisma._documents).toHaveLength(0);
    });

    it('uses the Transaction createdAt for financialYear/issuedAt, not wall-clock time', async () => {
      const prisma = fakePrisma();
      // Pushed into the backing array (not a findUnique override) so
      // reserveAndCreate's own transaction.update call (documentId
      // attachment) has a real row to find and mutate.
      prisma._transactions.push({
        id: 'txn-old',
        billingProfileId: 'bp-candidate',
        status: 'SUCCEEDED',
        basePaise: 29900,
        gstPaise: 5382,
        cgstPaise: 2691,
        sgstPaise: 2691,
        igstPaise: 0,
        amountPaise: 35282,
        placeOfSupplyStateCode: '27',
        createdAt: new Date('2025-02-10T00:00:00.000Z'), // backfill case: an old charge, financial year 2024-25
        description: 'Backfilled charge',
      });
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreate('txn-old');

      expect(doc.financialYear).toBe('2024-25');
      expect(doc.documentNumber).toBe('RCT/2024-25/000001');
      expect(doc.issuedAt).toEqual(new Date('2025-02-10T00:00:00.000Z'));
    });
  });

  describe('findOrgsWithAccrualsNeedingInvoice', () => {
    it('returns only orgs with at least one PENDING accrual whose request is STARTED or COMPLETED', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const orgs = await service.findOrgsWithAccrualsNeedingInvoice();

      expect(orgs.map((o) => o.billingProfileId).sort()).toEqual(['bp-org', 'bp-org-2']);
    });

    it('never returns an org whose only accrual is still unresolved (ACCRUED_PENDING_START) — never invoice before it is known to be billable', async () => {
      const prisma = fakePrisma();
      // Isolate bp-org-3 with only an unresolved accrual.
      prisma._transactions.push({
        id: 'txn-only-unresolved',
        billingProfileId: 'bp-org-3',
        type: 'ASSESSMENT_REQUEST_ACCRUAL',
        status: 'PENDING',
        documentId: null,
        basePaise: 15000,
        amountPaise: 17700,
        createdAt: new Date(),
        assessmentRequestId: 'areq-unresolved',
      });
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const orgs = await service.findOrgsWithAccrualsNeedingInvoice();

      expect(orgs.map((o) => o.billingProfileId)).not.toContain('bp-org-3');
    });

    it('never returns an org whose only accrual is EXPIRED_UNBILLED', async () => {
      const prisma = fakePrisma();
      // bp-org-2 already has one EXPIRED_UNBILLED accrual (txn-accrual-excluded)
      // alongside its one real STARTED one — remove the STARTED one so only
      // the excluded accrual remains, proving that alone is not enough to
      // qualify.
      prisma._transactions.length = 0;
      prisma._transactions.push({
        id: 'txn-accrual-excluded',
        billingProfileId: 'bp-org-2',
        type: 'ASSESSMENT_REQUEST_ACCRUAL',
        status: 'PENDING',
        documentId: null,
        basePaise: 15000,
        amountPaise: 17700,
        createdAt: new Date(),
        assessmentRequestId: 'areq-excluded',
      });
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const orgs = await service.findOrgsWithAccrualsNeedingInvoice();

      expect(orgs).toHaveLength(0);
    });
  });

  describe('reserveAndCreateForOrgPeriod', () => {
    it('aggregates every billable, uninvoiced accrual for one org into a single Document, summing amounts', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreateForOrgPeriod('bp-org');

      // Only txn-accrual-started-1/2 qualify (bp-org's unresolved accrual is excluded).
      expect(doc.basePaise).toBe(30000);
      expect(doc.gstPaise).toBe(5400);
      expect(doc.igstPaise).toBe(5400);
      expect(doc.totalPaise).toBe(35400);
    });

    it('series is TAX_INVOICE even for an org with no gstin on file — never the gstin-presence branch reserveAndCreate uses', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreateForOrgPeriod('bp-org-2');

      expect(doc.series).toBe(DocumentSeries.TAX_INVOICE);
      expect(doc.documentNumber).toMatch(/^INV\//);
    });

    it('flips every covered Transaction from PENDING to SUCCEEDED and attaches this Document', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreateForOrgPeriod('bp-org');

      const t1 = prisma._transactions.find((t: any) => t.id === 'txn-accrual-started-1');
      const t2 = prisma._transactions.find((t: any) => t.id === 'txn-accrual-started-2');
      expect(t1.status).toBe('SUCCEEDED');
      expect(t1.documentId).toBe(doc.id);
      expect(t2.status).toBe('SUCCEEDED');
      expect(t2.documentId).toBe(doc.id);

      // The unresolved accrual for the same org is untouched.
      const unresolved = prisma._transactions.find((t: any) => t.id === 'txn-accrual-unresolved');
      expect(unresolved.status).toBe('PENDING');
      expect(unresolved.documentId).toBeNull();
    });

    it('throws rather than reserving a number for an org with nothing billable and uninvoiced', async () => {
      const prisma = fakePrisma();
      prisma._transactions.length = 0; // no accruals at all
      const service = new DocumentsService(prisma, fakeStorage() as any);

      await expect(service.reserveAndCreateForOrgPeriod('bp-org')).rejects.toThrow(/no billable, uninvoiced accruals/);
      expect(prisma._documents).toHaveLength(0);
      expect(prisma.documentSequence.upsert).not.toHaveBeenCalled();
    });

    it('numbers against the same TAX_INVOICE sequence reserveAndCreate itself would use — no separate counter for the aggregate path', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const first = await service.reserveAndCreate('txn-invoice'); // an ordinary org TAX_INVOICE, numbered 1
      const aggregate = await service.reserveAndCreateForOrgPeriod('bp-org'); // must continue the same sequence, not restart at 1

      expect(first.documentNumber).toBe('INV/2026-27/000001');
      expect(aggregate.documentNumber).toBe('INV/2026-27/000002');
    });
  });

  describe('renderAndStore', () => {
    async function makeGeneratedFixture() {
      const prisma = fakePrisma();
      const storage = fakeStorage();
      const service = new DocumentsService(prisma, storage as any);
      const doc = await service.reserveAndCreate('txn-receipt');
      return { prisma, storage, service, doc };
    }

    it('renders a PDF, uploads it, and marks the document GENERATED', async () => {
      const { prisma, storage, service, doc } = await makeGeneratedFixture();

      await service.renderAndStore(doc.id);

      expect(storage.write).toHaveBeenCalledWith(`documents/${doc.id}.pdf`, expect.any(Buffer), 'application/pdf');
      const updated = prisma._documents.find((d: any) => d.id === doc.id);
      expect(updated.status).toBe(DocumentStatus.GENERATED);
      expect(updated.fileKey).toBe(`documents/${doc.id}.pdf`);
      expect(updated.generatedAt).toBeInstanceOf(Date);
    });

    it('on a storage failure, increments attempts and stays PENDING below the cap', async () => {
      const { prisma, storage, service, doc } = await makeGeneratedFixture();
      storage.write.mockRejectedValueOnce(new Error('S3 outage'));

      await service.renderAndStore(doc.id);

      const updated = prisma._documents.find((d: any) => d.id === doc.id);
      expect(updated.status).toBe(DocumentStatus.PENDING);
      expect(updated.generationAttempts).toBe(1);
      expect(updated.lastGenerationError).toBe('S3 outage');
    });

    it('escalates to FAILED_NEEDS_ATTENTION once attempts hit MAX_GENERATION_ATTEMPTS', async () => {
      const { prisma, storage, service, doc } = await makeGeneratedFixture();
      doc.generationAttempts = MAX_GENERATION_ATTEMPTS - 1; // one more failure exhausts retries
      storage.write.mockRejectedValueOnce(new Error('still down'));

      await service.renderAndStore(doc.id);

      const updated = prisma._documents.find((d: any) => d.id === doc.id);
      expect(updated.status).toBe(DocumentStatus.FAILED_NEEDS_ATTENTION);
      expect(updated.generationAttempts).toBe(MAX_GENERATION_ATTEMPTS);
    });

    it('never re-numbers on retry — sequenceNumber/documentNumber are untouched across a failed then successful render', async () => {
      const { prisma, storage, service, doc } = await makeGeneratedFixture();
      const originalNumber = doc.documentNumber;
      storage.write.mockRejectedValueOnce(new Error('transient'));

      await service.renderAndStore(doc.id);
      await service.renderAndStore(doc.id);

      const updated = prisma._documents.find((d: any) => d.id === doc.id);
      expect(updated.documentNumber).toBe(originalNumber);
      expect(updated.status).toBe(DocumentStatus.GENERATED);
      expect(prisma.documentSequence.upsert).toHaveBeenCalledTimes(1); // only ever reserved once
    });

    it('is a no-op for a document that is already GENERATED or FAILED_NEEDS_ATTENTION', async () => {
      const { prisma, storage, service, doc } = await makeGeneratedFixture();
      doc.status = DocumentStatus.FAILED_NEEDS_ATTENTION;

      await service.renderAndStore(doc.id);

      expect(storage.write).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a presigned URL for a GENERATED document', async () => {
      const prisma = fakePrisma();
      const storage = fakeStorage();
      const service = new DocumentsService(prisma, storage as any);
      const doc = { ...(await service.reserveAndCreate('txn-receipt')), status: DocumentStatus.GENERATED, fileKey: 'documents/doc-1.pdf' };

      const url = await service.getDownloadUrl(doc as any);

      expect(url).toBe('https://s3.example.com/presigned-url');
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith('documents/doc-1.pdf', { filename: `${doc.documentNumber.replace(/\//g, '-')}.pdf` });
    });

    it('409s on a document that is numbered but not yet rendered', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const doc = await service.reserveAndCreate('txn-receipt');

      await expect(service.getDownloadUrl(doc)).rejects.toThrow(/not ready/);
    });

    it('409s (not silently 200s) on a document stuck FAILED_NEEDS_ATTENTION', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const doc = { ...(await service.reserveAndCreate('txn-receipt')), status: DocumentStatus.FAILED_NEEDS_ATTENTION };

      await expect(service.getDownloadUrl(doc as any)).rejects.toThrow(/pending attention/);
    });
  });

  describe('listForAdmin', () => {
    it('with no status filter, includes FAILED_NEEDS_ATTENTION rows alongside every other status — nothing hidden by default', async () => {
      // This is the property GET /admin/documents (no query param) and the
      // admin dashboard's failed-count card both depend on: a document
      // that exhausts its retries must be visible without anyone having to
      // think to apply a status filter first.
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const pending = await service.reserveAndCreate('txn-receipt');
      const failed = await service.reserveAndCreate('txn-invoice');
      Object.assign(prisma._documents.find((d: any) => d.id === failed.id), { status: DocumentStatus.FAILED_NEEDS_ATTENTION });

      const all = await service.listForAdmin();

      expect(all.map((d) => d.id).sort()).toEqual([pending.id, failed.id].sort());
      expect(all.some((d) => d.status === DocumentStatus.FAILED_NEEDS_ATTENTION)).toBe(true);
    });

    it('a status filter narrows the list — e.g. exactly what the "needs attention" view/count would query', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const pending = await service.reserveAndCreate('txn-receipt');
      const failed = await service.reserveAndCreate('txn-invoice');
      Object.assign(prisma._documents.find((d: any) => d.id === failed.id), { status: DocumentStatus.FAILED_NEEDS_ATTENTION });

      const onlyFailed = await service.listForAdmin(DocumentStatus.FAILED_NEEDS_ATTENTION);

      expect(onlyFailed.map((d) => d.id)).toEqual([failed.id]);
      expect(onlyFailed.some((d) => d.id === pending.id)).toBe(false);
    });
  });

  describe('retry (admin)', () => {
    it('resets a FAILED_NEEDS_ATTENTION document back to PENDING with a clean attempt count', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const doc = await service.reserveAndCreate('txn-receipt');
      Object.assign(
        prisma._documents.find((d: any) => d.id === doc.id),
        { status: DocumentStatus.FAILED_NEEDS_ATTENTION, generationAttempts: MAX_GENERATION_ATTEMPTS, lastGenerationError: 'boom' },
      );

      const retried = await service.retry(doc.id);

      expect(retried.status).toBe(DocumentStatus.PENDING);
      expect(retried.generationAttempts).toBe(0);
      expect(retried.lastGenerationError).toBeNull();
    });

    it('refuses to retry a document that is not FAILED_NEEDS_ATTENTION', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const doc = await service.reserveAndCreate('txn-receipt'); // still PENDING

      await expect(service.retry(doc.id)).rejects.toThrow(/FAILED_NEEDS_ATTENTION/);
    });
  });

  describe('ownership-scoped lookups', () => {
    it('getOwnedByCandidateUser 404s (not throws a generic error) for a document belonging to someone else', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const doc = await service.reserveAndCreate('txn-invoice'); // owned by bp-org, not the candidate

      await expect(service.getOwnedByCandidateUser('user-candidate-1', doc.id)).rejects.toThrow('Document not found');
    });

    it('getOwnedByCandidateUser returns the document for its actual owner', async () => {
      const prisma = fakePrisma();
      // Wire bp-candidate to the candidate fixture so ownership resolves.
      const bp = await prisma.billingProfile.findUniqueOrThrow({ where: { id: 'bp-candidate' } });
      bp.candidateId = 'candidate-1';
      const service = new DocumentsService(prisma, fakeStorage() as any);
      const doc = await service.reserveAndCreate('txn-receipt');

      const found = await service.getOwnedByCandidateUser('user-candidate-1', doc.id);

      expect(found.id).toBe(doc.id);
    });
  });
});
