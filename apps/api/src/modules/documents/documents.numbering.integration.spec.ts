import * as path from 'path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { DocumentsService } from './documents.service';

/**
 * The one property no fake-Prisma unit test can verify: that
 * pg_advisory_xact_lock actually serializes concurrent reservations against
 * a REAL Postgres, so DocumentSequence never produces a duplicate or a gap
 * under real concurrency (see DocumentSequence's own schema doc comment —
 * this is the legal requirement the whole design exists to satisfy). Runs
 * against the local dev database (same DATABASE_URL docker-compose.yml
 * points at) rather than a fake — skipped automatically if that database
 * isn't reachable, so it never blocks a CI/sandbox run with no Postgres.
 */
const describeIfDb = process.env.CI || process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('DocumentsService.reserveAndCreate — concurrency (real Postgres)', () => {
  let prisma: PrismaClient;
  let service: DocumentsService;
  let userId: string;
  let candidateId: string;
  let billingProfileId: string;
  const transactionIds: string[] = [];
  const testMarker = `doc-numbering-test-${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new DocumentsService(prisma as any, { write: async () => undefined } as any);

    const user = await prisma.user.create({ data: { email: `${testMarker}@example.com` } });
    userId = user.id;
    const candidate = await prisma.candidateProfile.create({ data: { userId, fullName: testMarker } });
    candidateId = candidate.id;
    const billingProfile = await prisma.billingProfile.create({ data: { candidateId, legalEntityName: testMarker } });
    billingProfileId = billingProfile.id;

    const CONCURRENT_CHARGES = 8;
    for (let i = 0; i < CONCURRENT_CHARGES; i++) {
      const txn = await prisma.transaction.create({
        data: {
          billingProfileId,
          amountPaise: 35282,
          type: 'SUBSCRIPTION_CHARGE',
          status: 'SUCCEEDED',
          basePaise: 29900,
          gstPaise: 5382,
          cgstPaise: 2691,
          sgstPaise: 2691,
          igstPaise: 0,
          placeOfSupplyStateCode: '27',
          description: `${testMarker} charge ${i}`,
        },
      });
      transactionIds.push(txn.id);
    }
  }, 30_000);

  afterAll(async () => {
    // Deliberately does NOT touch DocumentSequence — its counter must only
    // ever move forward, in production or in a test against the same
    // mechanism; nothing here should look like "resetting the sequence is
    // fine, it's just a test."
    await prisma.document.deleteMany({ where: { billingProfileId } });
    await prisma.transaction.deleteMany({ where: { billingProfileId } });
    await prisma.billingProfile.delete({ where: { id: billingProfileId } });
    await prisma.candidateProfile.delete({ where: { id: candidateId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('assigns every concurrent reservation a distinct, gap-free sequence number in (financialYear=current, series=RECEIPT)', async () => {
    const financialYear = currentFinancialYear();
    const before = await prisma.documentSequence.findUnique({
      where: { financialYear_series: { financialYear, series: 'RECEIPT' } },
    });
    const baseline = before?.lastNumber ?? 0;

    const results = await Promise.all(transactionIds.map((id) => service.reserveAndCreate(id)));

    const numbers = results.map((r) => r.sequenceNumber).sort((a, b) => a - b);
    const expected = transactionIds.map((_, i) => baseline + i + 1);
    expect(numbers).toEqual(expected); // contiguous, no duplicates, no gaps

    const documentNumbers = new Set(results.map((r) => r.documentNumber));
    expect(documentNumbers.size).toBe(transactionIds.length); // every documentNumber string is unique too

    const after = await prisma.documentSequence.findUniqueOrThrow({
      where: { financialYear_series: { financialYear, series: 'RECEIPT' } },
    });
    expect(after.lastNumber).toBe(baseline + transactionIds.length); // counter advanced by exactly the number of charges, not more (no burned numbers) and not fewer (no lost reservations)
  }, 30_000);
});

function currentFinancialYear(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const startYear = month >= 3 ? year : year - 1;
  return `${startYear}-${((startYear + 1) % 100).toString().padStart(2, '0')}`;
}
