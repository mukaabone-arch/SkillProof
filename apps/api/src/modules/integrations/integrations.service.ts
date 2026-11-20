import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgType, Prisma, WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePackageService } from '../webhooks/candidate-package.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import {
  EVENTS_FOR_ORG_TYPE,
  MAX_API_KEYS_PER_ORG,
  MAX_WEBHOOKS_PER_ORG,
  WebhookEvent,
  newApiKey,
  newWebhookSecret,
  validateWebhookUrl,
} from '../webhooks/webhooks.util';
import { CreateWebhookDto, UpdateWebhookDto } from './integrations.dto';

const webhookView = {
  id: true,
  url: true,
  events: true,
  active: true,
  disabledReason: true,
  consecutiveFailures: true,
  lastDeliveryAt: true,
  createdAt: true,
} satisfies Prisma.OrgWebhookSelect;

/**
 * Settings → Integrations: an org admin's webhooks and API keys, plus the
 * candidate package download every member can use. Secrets and keys are
 * returned once, when created; after that only a prefix is shown.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: WebhookDispatcherService,
    private readonly packages: CandidatePackageService,
  ) {}

  async overview(orgId: string) {
    const type = await this.orgType(orgId);
    const [webhooks, apiKeys] = await Promise.all([
      this.prisma.orgWebhook.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: webhookView }),
      this.prisma.orgApiKey.findMany({
        where: { orgId, revokedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
      }),
    ]);
    return { availableEvents: EVENTS_FOR_ORG_TYPE[type], webhooks, apiKeys };
  }

  async createWebhook(orgId: string, userId: string, dto: CreateWebhookDto) {
    const type = await this.orgType(orgId);
    const url = this.checkUrl(dto.url);
    const events = this.checkEvents(type, dto.events);
    const count = await this.prisma.orgWebhook.count({ where: { orgId } });
    if (count >= MAX_WEBHOOKS_PER_ORG) throw new ConflictException(`You can have up to ${MAX_WEBHOOKS_PER_ORG} webhooks. Delete one first.`);
    const secret = newWebhookSecret();
    const hook = await this.prisma.orgWebhook.create({
      data: { orgId, url, events, secret, createdByUserId: userId },
      select: webhookView,
    });
    return { ...hook, secret };
  }

  async updateWebhook(orgId: string, id: string, dto: UpdateWebhookDto) {
    const type = await this.orgType(orgId);
    await this.ownedWebhook(orgId, id);
    return this.prisma.orgWebhook.update({
      where: { id },
      data: {
        ...(dto.url !== undefined ? { url: this.checkUrl(dto.url) } : {}),
        ...(dto.events !== undefined ? { events: this.checkEvents(type, dto.events) } : {}),
        // Turning an endpoint back on clears the failure streak that switched it off.
        ...(dto.active !== undefined ? { active: dto.active, ...(dto.active ? { consecutiveFailures: 0, disabledReason: null } : {}) } : {}),
      },
      select: webhookView,
    });
  }

  async rotateSecret(orgId: string, id: string) {
    await this.ownedWebhook(orgId, id);
    const secret = newWebhookSecret();
    await this.prisma.orgWebhook.update({ where: { id }, data: { secret } });
    return { id, secret };
  }

  async deleteWebhook(orgId: string, id: string) {
    await this.ownedWebhook(orgId, id);
    await this.prisma.orgWebhook.delete({ where: { id } });
    return { ok: true };
  }

  /** Sends one "webhook.test" event to this endpoint now and reports what happened. */
  async testWebhook(orgId: string, id: string) {
    const hook = await this.ownedWebhook(orgId, id);
    if (!hook.active) throw new ConflictException('Turn this webhook on before testing it.');
    const d = await this.prisma.webhookDelivery.create({ data: { webhookId: id, event: 'webhook.test', payload: {} } });
    const payload = {
      id: d.id,
      event: 'webhook.test' as WebhookEvent,
      createdAt: d.createdAt.toISOString(),
      data: { message: 'Test event from MyAmbii. If you can read this, your endpoint works.' },
    };
    await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { payload } });
    const result = await this.dispatcher.attempt(d.id);
    return { deliveryId: d.id, ...result };
  }

  async deliveries(orgId: string, webhookId: string) {
    await this.ownedWebhook(orgId, webhookId);
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, event: true, status: true, attempts: true, responseStatus: true, error: true, createdAt: true, deliveredAt: true, nextAttemptAt: true },
    });
  }

  /** Sends a delivery again now (any status), keeping the same id so receivers can de-duplicate. */
  async redeliver(orgId: string, deliveryId: string) {
    const d = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, webhook: { orgId } }, include: { webhook: { select: { active: true } } } });
    if (!d) throw new NotFoundException('Delivery not found');
    if (!d.webhook.active) throw new ConflictException('Turn this webhook on before sending again.');
    await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: null } });
    return { deliveryId: d.id, ...(await this.dispatcher.attempt(d.id)) };
  }

  async createApiKey(orgId: string, userId: string, name: string) {
    const count = await this.prisma.orgApiKey.count({ where: { orgId, revokedAt: null } });
    if (count >= MAX_API_KEYS_PER_ORG) throw new ConflictException(`You can have up to ${MAX_API_KEYS_PER_ORG} active keys. Revoke one first.`);
    const { key, hash, prefix } = newApiKey();
    const row = await this.prisma.orgApiKey.create({
      data: { orgId, name: name.trim(), prefix, keyHash: hash, createdByUserId: userId },
      select: { id: true, name: true, prefix: true, createdAt: true },
    });
    return { ...row, key };
  }

  async revokeApiKey(orgId: string, id: string) {
    const k = await this.prisma.orgApiKey.findFirst({ where: { id, orgId, revokedAt: null } });
    if (!k) throw new NotFoundException('API key not found');
    await this.prisma.orgApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  /** The JSON "Send to ATS" download: only for candidates this org already works with. */
  async candidatePackage(orgId: string, candidateId: string) {
    const type = await this.orgType(orgId);
    const rel = await this.packages.relationship(orgId, candidateId, type === OrgType.STAFFING);
    if (!rel.known) throw new NotFoundException('Candidate not found');
    return this.packages.build(orgId, candidateId);
  }

  private checkUrl(raw: string): string {
    const problem = validateWebhookUrl(raw);
    if (problem) throw new BadRequestException(problem);
    return new URL(raw.trim()).toString();
  }

  private checkEvents(type: OrgType, events: string[]): string[] {
    const allowed = EVENTS_FOR_ORG_TYPE[type] as readonly string[];
    const bad = events.filter((e) => !allowed.includes(e));
    if (bad.length) throw new BadRequestException(`Not available for your organisation: ${bad.join(', ')}`);
    return [...new Set(events)];
  }

  private async ownedWebhook(orgId: string, id: string) {
    const hook = await this.prisma.orgWebhook.findFirst({ where: { id, orgId } });
    if (!hook) throw new NotFoundException('Webhook not found');
    return hook;
  }

  private async orgType(orgId: string): Promise<OrgType> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { type: true } });
    return org?.type ?? OrgType.EMPLOYER;
  }
}
