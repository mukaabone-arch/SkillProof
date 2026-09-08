import { BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

function fakePrisma() {
  const profiles = new Map<string, { id: string; userId: string }>();
  const subscriptions = new Map<string, any>();

  return {
    candidateProfile: {
      findUnique: jest.fn(async ({ where }: any) => profiles.get(where.userId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const profile = { id: `profile-${data.userId}`, userId: data.userId };
        profiles.set(data.userId, profile);
        return profile;
      }),
    },
    subscription: {
      findUnique: jest.fn(async ({ where }: any) => subscriptions.get(where.candidateId) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...subscriptions.get(where.candidateId), ...data };
        subscriptions.set(where.candidateId, row);
        return row;
      }),
    },
  };
}

function fakeGateway() {
  return {
    createSubscription: jest.fn(async () => ({ id: 'sub_new1' })),
    cancelSubscription: jest.fn(async () => ({})),
    updateSubscriptionPlan: jest.fn(async () => ({})),
  };
}

describe('SubscriptionsService.initiateCheckout — candidatePremiumEnabled gate', () => {
  const originalFlag = process.env.CANDIDATE_PREMIUM_ENABLED;
  const originalPlanId = process.env.RAZORPAY_PLAN_ID_MONTHLY;
  const originalKeyId = process.env.RAZORPAY_KEY_ID;
  const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;

  beforeEach(() => {
    process.env.RAZORPAY_PLAN_ID_MONTHLY = 'plan_monthly_test';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.CANDIDATE_PREMIUM_ENABLED;
    else process.env.CANDIDATE_PREMIUM_ENABLED = originalFlag;
    if (originalPlanId === undefined) delete process.env.RAZORPAY_PLAN_ID_MONTHLY;
    else process.env.RAZORPAY_PLAN_ID_MONTHLY = originalPlanId;
    if (originalKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = originalKeyId;
    if (originalKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
  });

  it('rejects with PREMIUM_NOT_LAUNCHED and never touches Razorpay or the candidate profile when the flag is unset (default OFF)', async () => {
    delete process.env.CANDIDATE_PREMIUM_ENABLED;
    const prisma = fakePrisma();
    const gateway = fakeGateway();
    const svc = new SubscriptionsService(prisma as never, gateway as never);

    const err: BadRequestException = await svc.initiateCheckout('user-1', 'MONTHLY').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'PREMIUM_NOT_LAUNCHED' });
    expect(gateway.createSubscription).not.toHaveBeenCalled();
    expect(prisma.candidateProfile.findUnique).not.toHaveBeenCalled();
    expect(prisma.candidateProfile.create).not.toHaveBeenCalled();
  });

  it('rejects the same way for any non-"true" value, not just unset', async () => {
    process.env.CANDIDATE_PREMIUM_ENABLED = 'false';
    const svc = new SubscriptionsService(fakePrisma() as never, fakeGateway() as never);
    const err: BadRequestException = await svc.initiateCheckout('user-1', 'MONTHLY').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse()).toMatchObject({ code: 'PREMIUM_NOT_LAUNCHED' });
  });

  it('proceeds to create a real Razorpay subscription once the flag is on', async () => {
    process.env.CANDIDATE_PREMIUM_ENABLED = 'true';
    const prisma = fakePrisma();
    const gateway = fakeGateway();
    const svc = new SubscriptionsService(prisma as never, gateway as never);

    const result = await svc.initiateCheckout('user-1', 'MONTHLY');

    expect(result).toEqual({ subscriptionId: 'sub_new1', keyId: 'rzp_test_key' });
    expect(gateway.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'plan_monthly_test', notes: { candidateId: 'profile-user-1' } }),
    );
  });

  it('never gates cancel — an existing subscription can always be cancelled regardless of the flag', async () => {
    delete process.env.CANDIDATE_PREMIUM_ENABLED;
    const prisma = fakePrisma();
    (prisma.candidateProfile.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'profile-1', userId: 'user-1' });
    (prisma.subscription.findUnique as jest.Mock).mockResolvedValueOnce({ candidateId: 'profile-1', providerSubId: 'sub_existing' });
    const gateway = fakeGateway();
    const svc = new SubscriptionsService(prisma as never, gateway as never);

    await expect(svc.cancel('user-1')).resolves.toEqual({ cancelAtPeriodEnd: true });
    expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_existing', true);
  });
});
