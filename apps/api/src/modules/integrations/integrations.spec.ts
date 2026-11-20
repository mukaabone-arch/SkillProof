import { ExecutionContext } from '@nestjs/common';
import { OrgType, ShortlistStage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePackageService } from '../webhooks/candidate-package.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { hashApiKey } from '../webhooks/webhooks.util';
import { ProfilesService } from '../profiles/profiles.service';
import { ShortlistPipelineService } from '../shortlist/shortlist-pipeline.service';
import { StaffingSubmissionsService } from '../staffing/staffing-submissions.service';
import { IntegrationsService } from './integrations.service';
import { ApiKeyGuard } from './api-key.guard';
import { ApiV1Service } from './api-v1.service';

describe('IntegrationsService', () => {
  function setup(type: OrgType = OrgType.EMPLOYER, existing = 0) {
    const prisma = {
      organization: { findUnique: jest.fn(async () => ({ type })) },
      orgWebhook: {
        count: jest.fn(async () => existing),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'h1', url: data.url, events: data.events, active: true })),
      },
      orgApiKey: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'k1', name: data.name, prefix: data.prefix, createdAt: new Date() })),
      },
    };
    const packages = { relationship: jest.fn(async () => ({ known: false, contact: false, applied: false })), build: jest.fn() };
    const svc = new IntegrationsService(prisma as unknown as PrismaService, {} as WebhookDispatcherService, packages as unknown as CandidatePackageService);
    return { svc, prisma, packages };
  }

  it('creates a webhook, returning the signing secret once', async () => {
    const { svc, prisma } = setup();
    const r = await svc.createWebhook('o1', 'u1', { url: 'https://hooks.example.com/x', events: ['candidate.applied', 'candidate.applied'] });
    expect(r.secret).toMatch(/^whsec_/);
    expect((prisma.orgWebhook.create.mock.calls[0] as unknown as [{ data: { events: string[] } }])[0].data.events).toEqual(['candidate.applied']);
  });

  it('refuses private URLs, events the org type has no use for, and more than 5 endpoints', async () => {
    await expect(setup().svc.createWebhook('o1', 'u1', { url: 'https://192.168.0.2/x', events: ['candidate.applied'] })).rejects.toThrow(/private/);
    await expect(setup(OrgType.EMPLOYER).svc.createWebhook('o1', 'u1', { url: 'https://a.example.com', events: ['submission.status_changed'] })).rejects.toThrow(/Not available/);
    await expect(setup(OrgType.STAFFING).svc.createWebhook('o1', 'u1', { url: 'https://a.example.com', events: ['pipeline.stage_changed'] })).rejects.toThrow(/Not available/);
    await expect(setup(OrgType.EMPLOYER, 5).svc.createWebhook('o1', 'u1', { url: 'https://a.example.com', events: ['candidate.applied'] })).rejects.toThrow(/up to 5/);
  });

  it('creates an API key, storing only its hash', async () => {
    const { svc, prisma } = setup();
    const r = await svc.createApiKey('o1', 'u1', ' Zoho sync ');
    const data = (prisma.orgApiKey.create.mock.calls[0] as unknown as [{ data: { keyHash: string; name: string } }])[0].data;
    expect(r.key).toMatch(/^mya_/);
    expect(data.keyHash).toBe(hashApiKey(r.key));
    expect(data.name).toBe('Zoho sync');
    expect(JSON.stringify(data)).not.toContain(r.key);
  });

  it('candidate package only for candidates the org already works with', async () => {
    await expect(setup().svc.candidatePackage('o1', 'p1')).rejects.toThrow(/not found/);
  });
});

describe('ApiKeyGuard', () => {
  const ctx = (headers: Record<string, string>) => {
    const req: Record<string, unknown> = { headers };
    return { req, context: { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext };
  };
  function guard(row: unknown) {
    const prisma = { orgApiKey: { findUnique: jest.fn(async () => row), update: jest.fn(async () => ({})) } };
    return { g: new ApiKeyGuard(prisma as unknown as PrismaService), prisma };
  }
  const valid = { id: 'k1', orgId: 'o1', createdByUserId: 'u1', revokedAt: null, lastUsedAt: null, organization: { type: OrgType.STAFFING, verificationStatus: 'VERIFIED', deactivatedAt: null } };

  it('accepts a valid key and scopes the request to its org', async () => {
    const { g, prisma } = guard(valid);
    const { req, context } = ctx({ authorization: 'Bearer mya_secret' });
    await expect(g.canActivate(context)).resolves.toBe(true);
    expect(prisma.orgApiKey.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { keyHash: hashApiKey('mya_secret') } }));
    expect(req).toMatchObject({ orgId: 'o1', orgType: OrgType.STAFFING, apiKeyUserId: 'u1' });
  });

  it('refuses missing, unknown, revoked keys and inactive orgs', async () => {
    await expect(guard(valid).g.canActivate(ctx({}).context)).rejects.toThrow(/API key/);
    await expect(guard(null).g.canActivate(ctx({ 'x-api-key': 'mya_x' }).context)).rejects.toThrow(/not valid/);
    await expect(guard({ ...valid, revokedAt: new Date() }).g.canActivate(ctx({ 'x-api-key': 'mya_x' }).context)).rejects.toThrow(/revoked/);
    await expect(
      guard({ ...valid, organization: { ...valid.organization, verificationStatus: 'PENDING' } }).g.canActivate(ctx({ 'x-api-key': 'mya_x' }).context),
    ).rejects.toThrow(/not active/);
  });
});

describe('ApiV1Service', () => {
  function setup() {
    const pipeline = { invite: jest.fn(), offer: jest.fn(), outcome: jest.fn(), reject: jest.fn() };
    const submissions = { updateStatus: jest.fn(async () => ({ id: 's1', status: 'PLACED' })) };
    const prisma = {
      shortlistEntry: { findUnique: jest.fn(async () => ({ id: 'e1', stage: 'HIRED', updatedAt: new Date() })) },
      job: { findMany: jest.fn(async () => []) },
    };
    const svc = new ApiV1Service(
      prisma as unknown as PrismaService,
      {} as CandidatePackageService,
      {} as ProfilesService,
      pipeline as unknown as ShortlistPipelineService,
      submissions as unknown as StaffingSubmissionsService,
    );
    return { svc, pipeline, submissions, prisma };
  }

  it('maps pipeline actions onto the portal\'s own pipeline service', async () => {
    const { svc, pipeline } = setup();
    await svc.pipelineAction('o1', OrgType.EMPLOYER, 'u1', 'e1', { action: 'hire' });
    expect(pipeline.outcome).toHaveBeenCalledWith('o1', 'e1', { outcome: ShortlistStage.HIRED });
    await svc.pipelineAction('o1', OrgType.EMPLOYER, 'u1', 'e1', { action: 'reject', reason: 'Role filled' });
    expect(pipeline.reject).toHaveBeenCalledWith('o1', 'u1', 'e1', { reason: 'Role filled' });
  });

  it('keeps employers and recruiters on their own write endpoints', async () => {
    const { svc } = setup();
    await expect(svc.pipelineAction('o1', OrgType.STAFFING, 'u1', 'e1', { action: 'offer' })).rejects.toThrow(/submissions/);
    await expect(svc.submissionStatus('o1', OrgType.EMPLOYER, 's1', 'PLACED')).rejects.toThrow(/shortlist/);
  });

  it('validates list parameters', async () => {
    const { svc } = setup();
    await expect(svc.jobs('o1', { limit: '500' })).rejects.toThrow(/limit/);
    await expect(svc.jobs('o1', { updatedSince: 'yesterday' })).rejects.toThrow(/ISO/);
    await expect(svc.jobs('o1', { status: 'OPEN' })).rejects.toThrow(/status/);
    await expect(svc.jobs('o1', {})).resolves.toEqual({ data: [], next: null });
  });
});
