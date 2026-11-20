import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, WebhookDeliveryStatus } from '@prisma/client';
import { lookup } from 'dns/promises';
import { request } from 'https';
import { PrismaService } from '../../prisma/prisma.service';
import { CandidatePackageService } from './candidate-package.service';
import {
  DELIVERY_TIMEOUT_MS,
  WEBHOOK_DISABLE_AFTER,
  WebhookEvent,
  isPrivateAddress,
  retryAt,
  signPayload,
  validateWebhookUrl,
} from './webhooks.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_BATCH = 50;
const KEEP_DELIVERIES_DAYS = 30;

export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/**
 * Sends signed JSON events to an org's webhook endpoints.
 *
 * emit() never throws and never slows the request that caused the event:
 * it records one WebhookDelivery per subscribed endpoint and sends them in
 * the background. Failed sends are retried by the cron below
 * (RETRY_DELAYS_MIN), and an endpoint that keeps failing is switched off
 * with a reason the admin sees in Settings.
 *
 * Requests go only to public HTTPS addresses: the hostname is resolved and
 * every address checked (isPrivateAddress) on each attempt, the socket
 * connects to that checked address, and redirects are not followed.
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: CandidatePackageService,
  ) {}

  /** Fire-and-forget. `data` may include `candidateId`, which is expanded into the candidate package. */
  emit(orgId: string, event: WebhookEvent, data: Record<string, unknown> & { candidateId?: string }): void {
    void this.record(orgId, event, data).catch(() => this.logger.error(`Could not queue ${event} webhook`));
  }

  // ---- One-line helpers for the services where things happen. Each loads what the payload needs, in the background. ----

  applied(applicationId: string): void {
    void (async () => {
      const a = await this.prisma.application.findUnique({ where: { id: applicationId }, include: { job: { select: { id: true, orgId: true, code: true, title: true } } } });
      if (!a) return;
      await this.record(a.job.orgId, 'candidate.applied', {
        applicationId: a.id,
        appliedAt: a.createdAt.toISOString(),
        job: { id: a.job.id, code: a.job.code, title: a.job.title },
        candidateId: a.candidateProfileId,
      });
    })().catch(() => this.logger.error('Could not queue candidate.applied webhook'));
  }

  pipelineChanged(entryId: string, previousStage: string | null): void {
    void (async () => {
      const e = await this.prisma.shortlistEntry.findUnique({ where: { id: entryId }, include: { job: { select: { id: true, code: true, title: true } } } });
      if (!e) return;
      await this.record(e.orgId, 'pipeline.stage_changed', {
        entryId: e.id,
        stage: e.stage,
        previousStage,
        job: e.job,
        candidateId: e.candidateId,
      });
    })().catch(() => this.logger.error('Could not queue pipeline.stage_changed webhook'));
  }

  submissionChanged(submissionId: string, previousStatus: string | null): void {
    void (async () => {
      const s = await this.prisma.staffingSubmission.findUnique({ where: { id: submissionId }, include: { client: { select: { id: true, name: true } } } });
      if (!s) return;
      await this.record(s.orgId, 'submission.status_changed', {
        submissionId: s.id,
        status: s.status,
        previousStatus,
        roleTitle: s.roleTitle,
        client: s.client,
        projectRoleId: s.projectRoleId,
        candidateNote: s.candidateNote,
        candidateId: s.candidateId,
      });
    })().catch(() => this.logger.error('Could not queue submission.status_changed webhook'));
  }

  interested(messageId: string): void {
    void (async () => {
      const m = await this.prisma.outreachMessage.findUnique({
        where: { id: messageId },
        include: { campaign: { select: { id: true, job: { select: { id: true, code: true, title: true } } } } },
      });
      if (!m) return;
      await this.record(m.orgId, 'outreach.interested', {
        messageId: m.id,
        campaignId: m.campaign.id,
        job: m.campaign.job,
        candidateNote: m.candidateNote,
        respondedAt: m.respondedAt?.toISOString() ?? null,
        candidateId: m.candidateId,
      });
    })().catch(() => this.logger.error('Could not queue outreach.interested webhook'));
  }

  jobChanged(jobId: string, previousStatus: string | null): void {
    void (async () => {
      const j = await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true, orgId: true, code: true, title: true, status: true } });
      if (!j || j.status === previousStatus) return;
      await this.record(j.orgId, 'job.status_changed', { job: { id: j.id, code: j.code, title: j.title }, status: j.status, previousStatus });
    })().catch(() => this.logger.error('Could not queue job.status_changed webhook'));
  }

  /** Records deliveries for every active endpoint subscribed to this event, then sends them. Returns the delivery ids. */
  async record(orgId: string, event: WebhookEvent, data: Record<string, unknown> & { candidateId?: string }): Promise<string[]> {
    const hooks = await this.prisma.orgWebhook.findMany({
      where: { orgId, active: true, ...(event === 'webhook.test' ? {} : { events: { has: event } }) },
      select: { id: true },
    });
    if (hooks.length === 0) return [];

    const { candidateId, ...rest } = data;
    const candidate = candidateId ? await this.packages.build(orgId, candidateId).catch(() => null) : undefined;
    const ids: string[] = [];
    for (const h of hooks) {
      const d = await this.prisma.webhookDelivery.create({
        data: { webhookId: h.id, event, payload: {} as Prisma.InputJsonValue },
      });
      const payload = {
        id: d.id,
        event,
        createdAt: d.createdAt.toISOString(),
        data: { ...rest, ...(candidate !== undefined ? { candidate } : {}) },
      };
      await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { payload: payload as unknown as Prisma.InputJsonValue } });
      ids.push(d.id);
    }
    for (const id of ids) void this.attempt(id).catch(() => undefined);
    return ids;
  }

  /** One send attempt. Updates the delivery and the endpoint's failure count. */
  async attempt(deliveryId: string, now = new Date()): Promise<DeliveryResult> {
    const d = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
    if (!d || d.status === WebhookDeliveryStatus.SUCCEEDED) return { ok: true, status: d?.responseStatus ?? null, error: null };
    if (!d.webhook.active) {
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: WebhookDeliveryStatus.FAILED, nextAttemptAt: null, error: 'Endpoint switched off' },
      });
      return { ok: false, status: null, error: 'Endpoint switched off' };
    }

    const body = JSON.stringify(d.payload);
    const timestamp = Math.floor(now.getTime() / 1000);
    const result = await this.send(d.webhook.url, body, {
      'X-MyAmbii-Event': d.event,
      'X-MyAmbii-Delivery': d.id,
      'X-MyAmbii-Signature': signPayload(d.webhook.secret, body, timestamp),
    });

    const attempts = d.attempts + 1;
    if (result.ok) {
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: WebhookDeliveryStatus.SUCCEEDED, attempts, responseStatus: result.status, error: null, nextAttemptAt: null, deliveredAt: now },
      });
      await this.prisma.orgWebhook.update({ where: { id: d.webhookId }, data: { consecutiveFailures: 0, lastDeliveryAt: now } });
      return result;
    }

    const next = d.event === 'webhook.test' ? null : retryAt(attempts, now);
    await this.prisma.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: next ? WebhookDeliveryStatus.PENDING : WebhookDeliveryStatus.FAILED,
        attempts,
        responseStatus: result.status,
        error: result.error?.slice(0, 300) ?? null,
        nextAttemptAt: next,
      },
    });
    const hook = await this.prisma.orgWebhook.update({
      where: { id: d.webhookId },
      data: { consecutiveFailures: { increment: 1 }, lastDeliveryAt: now },
    });
    if (hook.consecutiveFailures >= WEBHOOK_DISABLE_AFTER && hook.active) {
      await this.prisma.orgWebhook.update({
        where: { id: hook.id },
        data: { active: false, disabledReason: `Switched off after ${WEBHOOK_DISABLE_AFTER} failed deliveries in a row. Fix the endpoint, then turn it back on.` },
      });
    }
    return result;
  }

  @Cron('* * * * *')
  async retryDue(now = new Date()): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: WebhookDeliveryStatus.PENDING, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: RETRY_BATCH,
      select: { id: true },
    });
    for (const d of due) await this.attempt(d.id, now).catch(() => undefined);
    return due.length;
  }

  @Cron('30 3 * * *')
  async pruneOld(now = new Date()): Promise<void> {
    await this.prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - KEEP_DELIVERIES_DAYS * DAY_MS) } } });
  }

  /** POSTs the body to a public HTTPS address only. 2xx = success; anything else, a timeout or a redirect = failure. */
  async send(url: string, body: string, headers: Record<string, string>): Promise<DeliveryResult> {
    const invalid = validateWebhookUrl(url);
    if (invalid) return { ok: false, status: null, error: invalid };
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    let address: string;
    let family: number;
    try {
      const all = await lookup(host, { all: true });
      if (all.length === 0 || all.some((a) => isPrivateAddress(a.address))) {
        return { ok: false, status: null, error: 'The address resolves to a private network.' };
      }
      ({ address, family } = all[0]);
    } catch {
      return { ok: false, status: null, error: 'Could not resolve the hostname.' };
    }

    return new Promise<DeliveryResult>((resolve) => {
      const req = request(
        {
          protocol: 'https:',
          hostname: host,
          port: u.port || 443,
          path: `${u.pathname}${u.search}`,
          method: 'POST',
          servername: host,
          // Connect to the address we just checked, never a fresh lookup.
          lookup: ((_h: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) =>
            opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as never,
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'MyAmbii-Webhooks/1', 'Content-Length': Buffer.byteLength(body), ...headers },
          timeout: DELIVERY_TIMEOUT_MS,
        },
        (res) => {
          res.resume();
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          resolve({ ok, status, error: ok ? null : status >= 300 && status < 400 ? 'Redirects are not followed.' : `HTTP ${status}` });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Timed out after 10 seconds.')));
      req.on('error', (e) => resolve({ ok: false, status: null, error: e.message }));
      req.end(body);
    });
  }
}
