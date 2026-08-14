import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExportRequestStatus, NotificationType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_SERVICE, StorageService } from '../../storage/storage.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { renderNotificationEmail } from '../notifications/notification-email.template';
import { WEB_BASE_URL } from '../../config/web-base-url';
import { DataExportBuilderService } from './data-export-builder.service';
import { ListExportRequestsQueryDto } from './data-export.dto';

class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** How long a READY export stays downloadable before the sweep expires it and deletes the file — "a reasonable window," not forever. */
const EXPORT_RETENTION_DAYS = 7;
/** A candidate may only have one export in flight, and can't ask again within this cooldown of their last *completed* (READY or FAILED) one — see assertNotRateLimited. */
const RE_REQUEST_COOLDOWN_HOURS = 24;
/** A PROCESSING row whose worker crashed mid-generation is requeued after this long — same "never left hanging" contract as AssessmentRequestsRefundJob's REFUND_FAILED retry. */
const STALLED_PROCESSING_MINUTES = 10;

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: DataExportBuilderService,
    private readonly notifications: NotificationsService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // ---------- Candidate-facing ----------

  async requestExport(userId: string) {
    const profile = await this.getOwnedProfile(userId);
    await this.assertNotRateLimited(profile.id);

    const request = await this.prisma.exportRequest.create({
      data: { candidateId: profile.id, status: ExportRequestStatus.REQUESTED },
    });
    return this.toCandidateDto(request);
  }

  async listMine(userId: string) {
    const profile = await this.getOwnedProfile(userId);
    const rows = await this.prisma.exportRequest.findMany({
      where: { candidateId: profile.id },
      orderBy: { requestedAt: 'desc' },
    });
    return rows.map((r) => this.toCandidateDto(r));
  }

  /**
   * Authenticated download — 404s for both "doesn't exist" and "not yours,"
   * same not-found-vs-not-yours convention as InterviewsService.getOwnedEntry,
   * so a candidate can never probe for another's export id. Returns a
   * short-lived presigned URL rather than proxying bytes — unlike the
   * photo/resume/cert-file reads, nothing here depends on a stable response
   * shape across clients, and an export file is exactly the kind of
   * one-shot, sizeable download presigned URLs exist for.
   */
  async downloadExport(userId: string, exportRequestId: string): Promise<{ url: string }> {
    const profile = await this.getOwnedProfile(userId);
    const request = await this.prisma.exportRequest.findUnique({ where: { id: exportRequestId } });
    if (!request || request.candidateId !== profile.id) throw new NotFoundException('Export not found');
    if (request.status === ExportRequestStatus.EXPIRED) {
      throw new NotFoundException('This export has expired — request a new one.');
    }
    if (request.status !== ExportRequestStatus.READY || !request.fileKey) {
      throw new ConflictException(`Export is not ready yet (status: ${request.status}).`);
    }
    if (request.expiresAt && request.expiresAt < new Date()) {
      throw new NotFoundException('This export has expired — request a new one.');
    }

    const url = await this.storage.getPresignedDownloadUrl(request.fileKey, {
      filename: `myambii-data-export-${exportRequestId.slice(0, 8)}.json`,
    });

    await this.prisma.exportRequest.update({
      where: { id: exportRequestId },
      data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
    });

    return { url };
  }

  private async assertNotRateLimited(candidateId: string): Promise<void> {
    const inFlight = await this.prisma.exportRequest.findFirst({
      where: { candidateId, status: { in: [ExportRequestStatus.REQUESTED, ExportRequestStatus.PROCESSING] } },
    });
    if (inFlight) {
      throw new TooManyRequestsException('You already have an export in progress — check back shortly.');
    }

    const recent = await this.prisma.exportRequest.findFirst({
      where: { candidateId, requestedAt: { gt: new Date(Date.now() - RE_REQUEST_COOLDOWN_HOURS * 3_600_000) } },
      orderBy: { requestedAt: 'desc' },
    });
    if (recent) {
      throw new TooManyRequestsException(
        `You can request a new export ${RE_REQUEST_COOLDOWN_HOURS} hours after your last one.`,
      );
    }
  }

  private async getOwnedProfile(userId: string) {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('No candidate profile found for this account.');
    return profile;
  }

  private toCandidateDto(r: {
    id: string;
    status: ExportRequestStatus;
    requestedAt: Date;
    completedAt: Date | null;
    expiresAt: Date | null;
    fileSizeBytes: number | null;
  }) {
    return {
      id: r.id,
      status: r.status,
      requestedAt: r.requestedAt,
      completedAt: r.completedAt,
      expiresAt: r.expiresAt,
      fileSizeBytes: r.fileSizeBytes,
    };
  }

  // ---------- Admin-facing (Compliance Center / Data Exports) ----------
  // Status/timestamps only — never the file content or candidate identity
  // beyond the same short opaque candidateRef the Privacy Requests view
  // already uses. See this method's own access-logging call: an admin
  // *listing* export requests is itself logged, matching the access-logging
  // pattern this feature introduces for candidate-scoped admin reads.

  async listForAdmin(adminUserId: string, query: ListExportRequestsQueryDto) {
    await this.logAdminAccess(adminUserId, 'VIEW_EXPORT_REQUESTS', 'ExportRequest', null, null);

    const rows = await this.prisma.exportRequest.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { requestedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      candidateRef: r.candidateId.slice(0, 8),
      status: r.status,
      requestedAt: r.requestedAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      expiresAt: r.expiresAt,
      failureReason: r.failureReason,
      fileSizeBytes: r.fileSizeBytes,
      downloadCount: r.downloadCount,
      lastDownloadedAt: r.lastDownloadedAt,
    }));
  }

  /** The only admin write in this feature — resets a FAILED row so the next sweep tick retries generation. Never touches READY/EXPIRED rows (nothing to retry) or the file content. */
  async retry(adminUserId: string, exportRequestId: string) {
    const request = await this.prisma.exportRequest.findUnique({ where: { id: exportRequestId } });
    if (!request) throw new NotFoundException('Export request not found');
    if (request.status !== ExportRequestStatus.FAILED) {
      throw new ConflictException(`Only a FAILED export can be retried (status: ${request.status}).`);
    }

    await this.logAdminAccess(adminUserId, 'RETRY_EXPORT_REQUEST', 'ExportRequest', exportRequestId, request.candidateId);

    return this.prisma.exportRequest.update({
      where: { id: exportRequestId },
      data: { status: ExportRequestStatus.REQUESTED, failureReason: null, startedAt: null },
    });
  }

  private async logAdminAccess(
    adminUserId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    candidateProfileId: string | null,
  ): Promise<void> {
    try {
      await this.prisma.adminAccessLog.create({
        data: { adminUserId, action, targetType, targetId, candidateProfileId },
      });
    } catch (err) {
      // Never let a logging failure block the admin's actual read — same
      // "audit trail is best-effort infrastructure, not a gate" posture as
      // NotificationsService.
      this.logger.error(`Failed to write AdminAccessLog for ${action}: ${(err as Error).message}`);
    }
  }

  // ---------- Called only by DataExportJob's sweep ----------

  async claimNextRequested(): Promise<{ id: string; candidateId: string } | null> {
    // Same atomic-claim shape as AssessmentRequestsRefundJob.refundOne's
    // PAID_PENDING_START claim: updateMany on a WHERE that includes the
    // expected current status, so two sweep ticks (or two instances) can
    // never both pick up the same row.
    const candidate = await this.prisma.exportRequest.findFirst({
      where: { status: ExportRequestStatus.REQUESTED },
      orderBy: { requestedAt: 'asc' },
    });
    if (!candidate) return null;

    const { count } = await this.prisma.exportRequest.updateMany({
      where: { id: candidate.id, status: ExportRequestStatus.REQUESTED },
      data: { status: ExportRequestStatus.PROCESSING, startedAt: new Date() },
    });
    if (count === 0) return null; // lost the race to another tick

    return { id: candidate.id, candidateId: candidate.candidateId };
  }

  async completeRequest(id: string, candidateProfileId: string): Promise<void> {
    const payload = await this.builder.build(candidateProfileId);
    const json = JSON.stringify(payload, null, 2);
    const buffer = Buffer.from(json, 'utf-8');

    const fileKey = `${randomUUID()}.json`;
    await this.storage.write(fileKey, buffer, 'application/json');

    const now = new Date();
    await this.prisma.exportRequest.update({
      where: { id },
      data: {
        status: ExportRequestStatus.READY,
        completedAt: now,
        expiresAt: new Date(now.getTime() + EXPORT_RETENTION_DAYS * 86_400_000),
        fileKey,
        fileSizeBytes: buffer.byteLength,
      },
    });

    const { userId } = await this.prisma.candidateProfile.findUniqueOrThrow({
      where: { id: candidateProfileId },
      select: { userId: true },
    });
    await this.notifications.sendEmail(
      userId,
      NotificationType.DATA_EXPORT_READY,
      'Your MyAmbii data export is ready',
      renderNotificationEmail(
        `<p>The data export you requested is ready to download from your account settings.</p>` +
          `<p>For your security, this download link expires in ${EXPORT_RETENTION_DAYS} days.</p>`,
        { label: 'Download your data', url: `${WEB_BASE_URL}/profile/account` },
      ),
    );
  }

  async failRequest(id: string, reason: string): Promise<void> {
    await this.prisma.exportRequest.update({
      where: { id },
      data: { status: ExportRequestStatus.FAILED, failureReason: reason.slice(0, 1000) },
    });
  }

  async requeueStalled(): Promise<number> {
    const { count } = await this.prisma.exportRequest.updateMany({
      where: {
        status: ExportRequestStatus.PROCESSING,
        startedAt: { lt: new Date(Date.now() - STALLED_PROCESSING_MINUTES * 60_000) },
      },
      data: { status: ExportRequestStatus.REQUESTED, startedAt: null },
    });
    return count;
  }

  async expireReady(): Promise<void> {
    const expired = await this.prisma.exportRequest.findMany({
      where: { status: ExportRequestStatus.READY, expiresAt: { lt: new Date() } },
    });
    for (const row of expired) {
      if (row.fileKey) {
        await this.storage.delete(row.fileKey).catch(() => undefined);
      }
      await this.prisma.exportRequest
        .update({ where: { id: row.id }, data: { status: ExportRequestStatus.EXPIRED, fileKey: null } })
        .catch(() => undefined);
    }
  }
}
