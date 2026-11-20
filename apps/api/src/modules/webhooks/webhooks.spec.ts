import { OrgType, WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePackageService } from './candidate-package.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { hashApiKey, isPrivateAddress, newApiKey, retryAt, signPayload, validateWebhookUrl, verifySignature } from './webhooks.util';

describe('webhooks.util', () => {
  it('signs and verifies, rejecting tampering and old timestamps', () => {
    const now = Date.parse('2026-11-20T00:00:00Z');
    const t = Math.floor(now / 1000);
    const header = signPayload('whsec_x', '{"a":1}', t);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature('whsec_x', '{"a":1}', header, 300, now)).toBe(true);
    expect(verifySignature('whsec_x', '{"a":2}', header, 300, now)).toBe(false);
    expect(verifySignature('whsec_y', '{"a":1}', header, 300, now)).toBe(false);
    expect(verifySignature('whsec_x', '{"a":1}', header, 300, now + 10 * 60_000)).toBe(false);
  });

  it('accepts only public https URLs', () => {
    expect(validateWebhookUrl('https://hooks.example.com/myambii')).toBeNull();
    expect(validateWebhookUrl('http://hooks.example.com')).toMatch(/https/);
    expect(validateWebhookUrl('https://localhost/x')).toMatch(/public/);
    expect(validateWebhookUrl('https://10.0.0.5/x')).toMatch(/private/);
    expect(validateWebhookUrl('https://[::1]/x')).toMatch(/private/);
    expect(validateWebhookUrl('https://user:pw@example.com')).toMatch(/username/);
    expect(validateWebhookUrl('not a url')).toMatch(/full URL/);
  });

  it('knows private address ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '13.234.1.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('API keys are random, prefixed, and stored only as a hash', () => {
    const a = newApiKey();
    const b = newApiKey();
    expect(a.key).toMatch(/^mya_/);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.prefix).toBe(a.key.slice(0, 12));
  });

  it('retries on a schedule, then gives up', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    expect(retryAt(1, now)?.toISOString()).toBe('2026-11-20T00:01:00.000Z');
    expect(retryAt(5, now)?.toISOString()).toBe('2026-11-20T06:00:00.000Z');
    expect(retryAt(6, now)).toBeNull();
  });
});

describe('CandidatePackageService', () => {
  const profile = {
    id: 'aaaaaaaa-1111-2222-3333-444444444444',
    fullName: 'Priya Sharma',
    headline: 'ML engineer',
    roleTitle: null,
    roleTitleOther: null,
    locationCity: 'Pune',
    locationRegion: null,
    locationCountry: 'IN',
    locationLegacy: null,
    openToRemote: true,
    yearsOfExp: 5,
    aiYearsOfExp: 2,
    resumeS3Key: 'r.pdf',
    deletedAt: null,
    user: { email: 'p@example.com', phone: '+919999999999' },
    skillClaims: [
      {
        level: 'L2',
        skill: { name: 'RAG Systems' },
        badge: { verifiedBy: 'TEST', verifyHash: 'abc', issuedAt: new Date('2026-01-01'), expiresAt: new Date('2027-01-01'), revokedAt: null },
      },
    ],
    certifications: [],
  };

  function setup(type: OrgType, rel: { application?: boolean; interested?: boolean; consented?: boolean }) {
    const prisma = {
      organization: { findUnique: jest.fn(async () => ({ type })) },
      candidateProfile: { findUnique: jest.fn(async () => profile) },
      application: { findFirst: jest.fn(async () => (rel.application ? { id: 'a' } : null)) },
      outreachMessage: { findFirst: jest.fn(async () => (rel.interested ? { id: 'm' } : null)) },
      staffingSubmission: { findFirst: jest.fn(async (args: { where: { consentedAt?: unknown } }) => (args.where.consentedAt && rel.consented ? { id: 's' } : null)) },
      staffingAvailabilityRequest: { findFirst: jest.fn(async () => null) },
      shortlistEntry: { findFirst: jest.fn(async () => ({ id: 'e' })) },
    };
    return new CandidatePackageService(prisma as unknown as PrismaService);
  }

  it('employer: name always, contact and resume only after applying', async () => {
    const searchOnly = await setup(OrgType.EMPLOYER, {}).build('o1', profile.id);
    expect(searchOnly.name).toBe('Priya Sharma');
    expect(searchOnly.contact).toBeNull();
    expect(searchOnly.resumeApiPath).toBeNull();
    expect(searchOnly.verifiedSkills[0]).toMatchObject({ skill: 'RAG Systems', level: 'L2', levelName: 'Practitioner' });
    expect(searchOnly.verifiedSkills[0].verifyUrl).toMatch(/\/badges\/abc$/);

    const applied = await setup(OrgType.EMPLOYER, { application: true }).build('o1', profile.id);
    expect(applied.contact).toEqual({ email: 'p@example.com', phone: '+919999999999' });
    expect(applied.resumeApiPath).toBe(`/v1/candidates/${profile.id}/resume`);
  });

  it('Interested to AI sourcing shares contact but not the resume', async () => {
    const p = await setup(OrgType.EMPLOYER, { interested: true }).build('o1', profile.id);
    expect(p.contact).not.toBeNull();
    expect(p.resumeApiPath).toBeNull();
  });

  it('recruiter: anonymous until the candidate consents', async () => {
    const anon = await setup(OrgType.STAFFING, {}).build('o1', profile.id);
    expect(anon.name).toBeNull();
    expect(anon.headline).toBeNull();
    expect(anon.contact).toBeNull();
    expect(anon.ref).toBe('C-AAAAAA');
    const consented = await setup(OrgType.STAFFING, { consented: true }).build('o1', profile.id);
    expect(consented.name).toBe('Priya Sharma');
    expect(consented.contact).not.toBeNull();
  });
});

describe('WebhookDispatcherService', () => {
  function setup(hookOver: Record<string, unknown> = {}, deliveryOver: Record<string, unknown> = {}) {
    const hook = { id: 'h1', url: 'https://hooks.example.com/x', secret: 'whsec_x', active: true, consecutiveFailures: 0, ...hookOver };
    const delivery = { id: 'd1', webhookId: 'h1', event: 'candidate.applied', payload: { id: 'd1' }, status: WebhookDeliveryStatus.PENDING, attempts: 0, webhook: hook, ...deliveryOver };
    const prisma = {
      orgWebhook: {
        findMany: jest.fn(async () => [{ id: 'h1' }]),
        update: jest.fn(async (args: { data: { consecutiveFailures?: { increment: number } } }) => ({
          ...hook,
          consecutiveFailures: args.data.consecutiveFailures ? hook.consecutiveFailures + 1 : 0,
        })),
      },
      webhookDelivery: {
        findUnique: jest.fn(async () => delivery),
        create: jest.fn(async () => ({ id: 'd1', createdAt: new Date('2026-11-20T00:00:00Z') })),
        update: jest.fn(async () => ({})),
      },
    };
    const packages = { build: jest.fn(async () => ({ id: 'p1', name: 'Priya' })) };
    const svc = new WebhookDispatcherService(prisma as unknown as PrismaService, packages as unknown as CandidatePackageService);
    return { svc, prisma, packages };
  }

  it('records one delivery per subscribed endpoint with the candidate package inside', async () => {
    const { svc, prisma } = setup();
    jest.spyOn(svc, 'attempt').mockResolvedValue({ ok: true, status: 200, error: null });
    const ids = await svc.record('o1', 'candidate.applied', { applicationId: 'a1', candidateId: 'p1' });
    expect(ids).toEqual(['d1']);
    expect(prisma.orgWebhook.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orgId: 'o1', active: true, events: { has: 'candidate.applied' } } }));
    const payload = (prisma.webhookDelivery.update.mock.calls[0] as unknown as [{ data: { payload: { data: Record<string, unknown> } } }])[0].data.payload;
    expect(payload).toMatchObject({ id: 'd1', event: 'candidate.applied', data: { applicationId: 'a1', candidate: { id: 'p1', name: 'Priya' } } });
    expect(payload.data.candidateId).toBeUndefined();
  });

  it('a 2xx marks the delivery succeeded and resets the failure streak, with a signature header', async () => {
    const { svc, prisma } = setup();
    const send = jest.spyOn(svc, 'send').mockResolvedValue({ ok: true, status: 204, error: null });
    await svc.attempt('d1');
    expect(send.mock.calls[0][2]['X-MyAmbii-Signature']).toMatch(/^t=\d+,v1=/);
    expect(send.mock.calls[0][2]['X-MyAmbii-Delivery']).toBe('d1');
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED', attempts: 1 }) }));
    expect(prisma.orgWebhook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ consecutiveFailures: 0 }) }));
  });

  it('a failure schedules a retry; the last failure gives up; a long streak switches the endpoint off', async () => {
    const a = setup();
    jest.spyOn(a.svc, 'send').mockResolvedValue({ ok: false, status: 500, error: 'HTTP 500' });
    await a.svc.attempt('d1', new Date('2026-11-20T00:00:00Z'));
    expect(a.prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', nextAttemptAt: new Date('2026-11-20T00:01:00Z') }) }),
    );

    const b = setup({ consecutiveFailures: 19 }, { attempts: 5 });
    jest.spyOn(b.svc, 'send').mockResolvedValue({ ok: false, status: null, error: 'Timed out' });
    await b.svc.attempt('d1');
    expect(b.prisma.webhookDelivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', nextAttemptAt: null }) }));
    expect(b.prisma.orgWebhook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ active: false }) }));
  });

  it('never sends to private addresses', async () => {
    const { svc } = setup();
    expect(await svc.send('https://127.0.0.1/x', '{}', {})).toMatchObject({ ok: false, error: expect.stringMatching(/private/) });
    expect(await svc.send('http://example.com/x', '{}', {})).toMatchObject({ ok: false });
  });

  it('emit never throws, even when the database does', async () => {
    const { svc, prisma } = setup();
    prisma.orgWebhook.findMany.mockRejectedValue(new Error('db down'));
    expect(() => svc.emit('o1', 'job.status_changed', {})).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});

