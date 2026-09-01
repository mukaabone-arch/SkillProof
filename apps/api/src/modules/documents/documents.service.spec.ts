import { DocumentSeries, DocumentStatus } from '@prisma/client';
import { DocumentsService, MAX_GENERATION_ATTEMPTS } from './documents.service';

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
  ];
  const candidateProfiles: any[] = [{ id: 'candidate-1', userId: 'user-candidate-1' }];

  const documentModel = {
    findUnique: jest.fn(async ({ where }: any) => documents.find((d) => (where.id ? d.id === where.id : d.transactionId === where.transactionId)) ?? null),
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
    document: documentModel,
    documentSequence: documentSequenceModel,
    transaction: {
      findUnique: jest.fn(async ({ where }: any) => transactions.find((t) => t.id === where.id) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const row = transactions.find((t) => t.id === where.id);
        if (!row) throw new Error('not found');
        return row;
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
      expect(doc.sacCode).toBe('998313');
    });

    it('two documents in the same (financialYear, series) get sequential numbers, not the same one', async () => {
      const prisma = fakePrisma();
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const first = await service.reserveAndCreate('txn-receipt');
      // A second GST-bearing charge on the same billing profile/series (e.g. a renewal) — clone the fixture under a new transaction id.
      const clone = {
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
      };
      const originalFindUnique = prisma.transaction.findUnique;
      prisma.transaction.findUnique = jest.fn(async ({ where }: any) =>
        where.id === 'txn-receipt-clone' ? clone : originalFindUnique({ where }),
      );
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
      prisma.transaction.findUnique = jest.fn(async () => ({
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
      }));
      const service = new DocumentsService(prisma, fakeStorage() as any);

      const doc = await service.reserveAndCreate('txn-old');

      expect(doc.financialYear).toBe('2024-25');
      expect(doc.documentNumber).toBe('RCT/2024-25/000001');
      expect(doc.issuedAt).toEqual(new Date('2025-02-10T00:00:00.000Z'));
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
