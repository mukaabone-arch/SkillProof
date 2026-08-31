import { createHmac } from 'crypto';
import { TransactionsService } from '../billing/transactions.service';
import { SubscriptionBillingProfileService } from './subscription-billing-profile.service';
import { RazorpayWebhookService } from './razorpay-webhook.service';

const WEBHOOK_SECRET = 'whsec_test_1234567890';

function sign(body: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function subscriptionPayload(overrides: {
  event: string;
  createdAt: number;
  subscriptionId?: string;
  status?: string;
  planId?: string;
  currentStart?: number;
  currentEnd?: number;
  candidateId?: string;
  payment?: { id: string; amount: number; currency: string };
}) {
  return {
    event: overrides.event,
    created_at: overrides.createdAt,
    payload: {
      subscription: {
        entity: {
          id: overrides.subscriptionId ?? 'sub_test1',
          status: overrides.status ?? 'active',
          plan_id: overrides.planId ?? 'plan_monthly',
          current_start: overrides.currentStart ?? overrides.createdAt,
          current_end: overrides.currentEnd ?? overrides.createdAt + 30 * 24 * 60 * 60,
          notes: (overrides.candidateId ? { candidateId: overrides.candidateId } : {}) as Record<string, string>,
        },
      },
      ...(overrides.payment ? { payment: { entity: overrides.payment } } : {}),
    },
  };
}

function fakePrisma() {
  const subscriptions = new Map<string, any>();
  const webhookEvents = new Map<string, any>();
  const transactions: any[] = [];
  const billingProfiles = new Map<string, any>();

  const prisma: Record<string, any> = {
    subscription: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.providerSubId) {
          return [...subscriptions.values()].find((s) => s.providerSubId === where.providerSubId) ?? null;
        }
        return subscriptions.get(where.candidateId) ?? null;
      }),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = subscriptions.get(where.candidateId);
        const row = existing ? { ...existing, ...update } : { candidateId: where.candidateId, ...create };
        subscriptions.set(where.candidateId, row);
        return row;
      }),
    },
    razorpayWebhookEvent: {
      findUnique: jest.fn(async ({ where }: any) => webhookEvents.get(where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { ...data, receivedAt: new Date(), processedAt: null, applied: false };
        webhookEvents.set(data.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...webhookEvents.get(where.id), ...data };
        webhookEvents.set(where.id, row);
        return row;
      }),
    },
    transaction: {
      findFirst: jest.fn(async ({ where }: any) => transactions.find((t) => t.providerPaymentId === where.providerPaymentId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `txn-${transactions.length + 1}`, ...data };
        transactions.push(row);
        return row;
      }),
    },
    billingProfile: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.candidateId) return billingProfiles.get(where.candidateId) ?? null;
        if (where.id) return [...billingProfiles.values()].find((p) => p.id === where.id) ?? null;
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `bp-${billingProfiles.size + 1}`, ...data };
        billingProfiles.set(data.candidateId, row);
        return row;
      }),
    },
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, fullName: 'Test Candidate', user: { email: 'candidate@example.com' } })),
    },
  };

  return { prisma, subscriptions, webhookEvents, transactions, billingProfiles };
}

function buildService() {
  const { prisma, subscriptions, webhookEvents, transactions, billingProfiles } = fakePrisma();
  const transactionsService = new TransactionsService(prisma as never);
  const billingProfileService = new SubscriptionBillingProfileService(prisma as never);
  const svc = new RazorpayWebhookService(prisma as never, transactionsService, billingProfileService);
  return { svc, prisma, subscriptions, webhookEvents, transactions, billingProfiles };
}

describe('RazorpayWebhookService.verifySignature', () => {
  const original = process.env.RAZORPAY_WEBHOOK_SECRET;
  beforeAll(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
  afterAll(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = original;
  });

  const { svc } = buildService();

  it('accepts a correctly signed body', () => {
    const body = Buffer.from('{"event":"subscription.activated"}');
    expect(svc.verifySignature(body, sign(body.toString()))).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = Buffer.from('{"event":"subscription.activated"}');
    const signature = sign(body.toString());
    const tampered = Buffer.from('{"event":"subscription.cancelled"}');
    expect(svc.verifySignature(tampered, signature)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    const body = Buffer.from('{"event":"subscription.activated"}');
    expect(svc.verifySignature(body, undefined)).toBe(false);
  });

  it('rejects when the webhook secret is not configured', () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const body = Buffer.from('{}');
    expect(svc.verifySignature(body, sign('{}'))).toBe(false);
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });
});

describe('RazorpayWebhookService.handle', () => {
  it('creates a Subscription row from notes.candidateId on the first event for a new provider subscription', async () => {
    const { svc, subscriptions } = buildService();
    await svc.handle('evt_1', subscriptionPayload({ event: 'subscription.activated', createdAt: 1000, candidateId: 'cand-1' }));

    const row = subscriptions.get('cand-1');
    expect(row).toMatchObject({ tier: 'PREMIUM', status: 'ACTIVE', provider: 'razorpay', providerSubId: 'sub_test1' });
  });

  it('is idempotent — redelivering the same event id does not reprocess it', async () => {
    const { svc, prisma } = buildService();
    const payload = subscriptionPayload({ event: 'subscription.activated', createdAt: 1000, candidateId: 'cand-1' });
    await svc.handle('evt_dup', payload);
    const upsertCallsAfterFirst = (prisma.subscription.upsert as jest.Mock).mock.calls.length;

    await svc.handle('evt_dup', payload);
    expect((prisma.subscription.upsert as jest.Mock).mock.calls.length).toBe(upsertCallsAfterFirst);
  });

  it('discards a stale, out-of-order event without regressing a row a newer event already advanced', async () => {
    const { svc, subscriptions } = buildService();
    // Newer event arrives first (activated at t=2000, PAST_DUE-adjacent halted logic aside — use pending to move status).
    await svc.handle('evt_new', subscriptionPayload({ event: 'subscription.activated', createdAt: 2000, candidateId: 'cand-1', status: 'active' }));
    // Older event (t=1000) arrives late, claiming 'halted' — must not override the row the newer event already set.
    await svc.handle('evt_old', subscriptionPayload({ event: 'subscription.halted', createdAt: 1000, candidateId: 'cand-1', status: 'halted' }));

    const row = subscriptions.get('cand-1');
    expect(row.status).toBe('ACTIVE');
  });

  it('never touches a row with no matching providerSubId and no notes.candidateId', async () => {
    const { svc, subscriptions } = buildService();
    await svc.handle('evt_orphan', subscriptionPayload({ event: 'subscription.pending', createdAt: 1000, status: 'pending' }));
    expect(subscriptions.size).toBe(0);
  });

  it('is a no-op for pre-activation events (authenticated/expired)', async () => {
    const { svc, subscriptions } = buildService();
    await svc.handle(
      'evt_auth',
      subscriptionPayload({ event: 'subscription.authenticated', createdAt: 1000, candidateId: 'cand-1', status: 'authenticated' }),
    );
    expect(subscriptions.size).toBe(0);
  });

  it('records a Transaction for subscription.charged, auto-provisioning a minimal BillingProfile', async () => {
    const { svc, transactions, billingProfiles } = buildService();
    await svc.handle(
      'evt_charged',
      subscriptionPayload({
        event: 'subscription.charged',
        createdAt: 1000,
        candidateId: 'cand-1',
        payment: { id: 'pay_1', amount: 29900, currency: 'INR' },
      }),
    );

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      amountPaise: 29900,
      type: 'SUBSCRIPTION_CHARGE',
      status: 'SUCCEEDED',
      provider: 'razorpay',
      providerPaymentId: 'pay_1',
      createdByAdminId: null,
    });
    expect(billingProfiles.get('cand-1')).toMatchObject({ candidateId: 'cand-1', legalEntityName: 'Test Candidate' });
  });

  describe('GST split on subscription.charged', () => {
    const originalMonthly = process.env.RAZORPAY_PLAN_ID_MONTHLY;
    const originalAnnual = process.env.RAZORPAY_PLAN_ID_ANNUAL;

    beforeEach(() => {
      process.env.RAZORPAY_PLAN_ID_MONTHLY = 'plan_gst_monthly';
      process.env.RAZORPAY_PLAN_ID_ANNUAL = 'plan_gst_annual';
    });
    afterEach(() => {
      process.env.RAZORPAY_PLAN_ID_MONTHLY = originalMonthly;
      process.env.RAZORPAY_PLAN_ID_ANNUAL = originalAnnual;
    });

    it('records the full base/gst/cgst/sgst split, defaulting place of supply to Maharashtra when the auto-created BillingProfile has no state on file', async () => {
      const { svc, transactions } = buildService();
      await svc.handle(
        'evt_gst_1',
        subscriptionPayload({
          event: 'subscription.charged',
          createdAt: 1000,
          candidateId: 'cand-1',
          planId: 'plan_gst_monthly',
          payment: { id: 'pay_gst_1', amount: 35282, currency: 'INR' }, // ₹352.82 — the GST-inclusive total
        }),
      );

      expect(transactions[0]).toMatchObject({
        amountPaise: 35282,
        basePaise: 29900,
        gstPaise: 5382,
        cgstPaise: 2691,
        sgstPaise: 2691,
        igstPaise: 0,
        placeOfSupplyStateCode: '27',
      });
    });

    it('records IGST instead when the BillingProfile has a non-Maharashtra state on file', async () => {
      const { svc, prisma, billingProfiles, transactions } = buildService();
      // Pre-seed a BillingProfile with a known out-of-state code, same
      // shape ensureMinimalBillingProfile would find via findUnique.
      billingProfiles.set('cand-1', { id: 'bp-1', candidateId: 'cand-1', gstStateCode: '29' }); // Karnataka

      await svc.handle(
        'evt_gst_2',
        subscriptionPayload({
          event: 'subscription.charged',
          createdAt: 1000,
          candidateId: 'cand-1',
          planId: 'plan_gst_annual',
          payment: { id: 'pay_gst_2', amount: 353882, currency: 'INR' }, // ₹3,538.82
        }),
      );

      expect(transactions[0]).toMatchObject({
        amountPaise: 353882,
        basePaise: 299900,
        gstPaise: 53982,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 53982,
        placeOfSupplyStateCode: '29',
      });
      expect(prisma.billingProfile.findUnique).toHaveBeenCalled();
    });

    it('records no GST split at all for a charge on a Plan that is no longer the configured one — an existing pre-GST subscriber stays on their original amount, un-fabricated', async () => {
      const { svc, transactions } = buildService();
      await svc.handle(
        'evt_gst_legacy',
        subscriptionPayload({
          event: 'subscription.charged',
          createdAt: 1000,
          candidateId: 'cand-1',
          planId: 'plan_old_pre_gst', // does not match either configured env plan id
          payment: { id: 'pay_legacy', amount: 29900, currency: 'INR' }, // the old, flat, non-GST amount
        }),
      );

      expect(transactions[0]).toMatchObject({ amountPaise: 29900 });
      expect(transactions[0].basePaise).toBeNull();
      expect(transactions[0].gstPaise).toBeNull();
      expect(transactions[0].cgstPaise).toBeNull();
      expect(transactions[0].sgstPaise).toBeNull();
      expect(transactions[0].igstPaise).toBeNull();
      expect(transactions[0].placeOfSupplyStateCode).toBeNull();
    });

    it('records no split (fails safe, still records the base charge) if the computed GST total does not match what was actually charged', async () => {
      const { svc, transactions } = buildService();
      await svc.handle(
        'evt_gst_mismatch',
        subscriptionPayload({
          event: 'subscription.charged',
          createdAt: 1000,
          candidateId: 'cand-1',
          planId: 'plan_gst_monthly',
          // Wrong amount for this plan (should be 35282) — simulates a
          // misconfigured Razorpay Plan.
          payment: { id: 'pay_mismatch', amount: 30000, currency: 'INR' },
        }),
      );

      expect(transactions[0]).toMatchObject({ amountPaise: 30000 });
      expect(transactions[0].basePaise).toBeNull();
    });
  });

  it('never records a second Transaction for the same providerPaymentId, even across two separate events', async () => {
    const { svc, transactions } = buildService();
    const payment = { id: 'pay_dup', amount: 29900, currency: 'INR' };
    await svc.handle('evt_c1', subscriptionPayload({ event: 'subscription.charged', createdAt: 1000, candidateId: 'cand-1', payment }));
    await svc.handle('evt_c2', subscriptionPayload({ event: 'subscription.charged', createdAt: 2000, candidateId: 'cand-1', payment }));
    expect(transactions).toHaveLength(1);
  });

  it('maps halted/pending to PAST_DUE and cancelled to CANCELED', async () => {
    const { svc, subscriptions } = buildService();
    await svc.handle('evt_a', subscriptionPayload({ event: 'subscription.activated', createdAt: 1000, candidateId: 'cand-1', status: 'active' }));
    await svc.handle('evt_h', subscriptionPayload({ event: 'subscription.halted', createdAt: 2000, candidateId: 'cand-1', status: 'halted' }));
    expect(subscriptions.get('cand-1').status).toBe('PAST_DUE');

    await svc.handle('evt_c', subscriptionPayload({ event: 'subscription.cancelled', createdAt: 3000, candidateId: 'cand-1', status: 'cancelled' }));
    expect(subscriptions.get('cand-1').status).toBe('CANCELED');
  });
});
