import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AiContentReportReason,
  AiContentReportStatus,
  AiContentTarget,
  Prisma,
  RagL2Claim,
  SessionTurnRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Generous for a real person, low enough that the queue can't be flooded. */
export const DAILY_REPORT_LIMIT = 20;
const SNAPSHOT_MAX_CHARS = 4000;

export interface CreateReportInput {
  sessionId: string;
  targetType: AiContentTarget;
  targetId: string;
  reason: AiContentReportReason;
  note?: string;
}

/**
 * In-app reporting of AI-generated content — Google Play's AI-Generated
 * Content policy requires that users can flag offensive AI output without
 * leaving the app. A candidate can report, on their OWN session only:
 *  - ASSESSOR_TURN: an AI interviewer message
 *  - LIVE_FEEDBACK: a live "Reviewer notes" card
 *  - RESULT_REASON: a claim's reason on the result page
 * The reported text is snapshotted at report time for the admin queue.
 * One report per user per item (a second tap returns the first report).
 */
@Injectable()
export class AiContentReportsService {
  private readonly logger = new Logger(AiContentReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateReportInput) {
    const session = await this.prisma.assessmentSession.findUnique({
      where: { id: input.sessionId },
      select: { userId: true },
    });
    // Same 404 for "not yours" and "doesn't exist" — never confirm another
    // user's session id.
    if (!session || session.userId !== userId) throw new NotFoundException('Session not found.');

    const existing = await this.prisma.aiContentReport.findFirst({
      where: { userId, targetType: input.targetType, targetId: input.targetId },
      select: { id: true, status: true },
    });
    if (existing) return { id: existing.id, status: existing.status, duplicate: true };

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.aiContentReport.count({ where: { userId, createdAt: { gte: since } } });
    if (recent >= DAILY_REPORT_LIMIT) {
      throw new HttpException(
        "You've sent a lot of reports today. Please try again tomorrow, or contact support.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const snapshot = await this.snapshot(input.sessionId, input.targetType, input.targetId);

    try {
      const report = await this.prisma.aiContentReport.create({
        data: {
          userId,
          sessionId: input.sessionId,
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          note: input.note?.trim() || null,
          contentSnapshot: snapshot.slice(0, SNAPSHOT_MAX_CHARS),
        },
        select: { id: true, status: true },
      });
      // warn, not log: a report should stand out when scanning the logs.
      this.logger.warn(`AI content reported: ${report.id} (${input.targetType}, ${input.reason}) session ${input.sessionId}`);
      return { id: report.id, status: report.status, duplicate: false };
    } catch (err) {
      // Double-tap race on the (userId, targetType, targetId) unique key.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.aiContentReport.findFirst({
          where: { userId, targetType: input.targetType, targetId: input.targetId },
          select: { id: true, status: true },
        });
        if (again) return { id: again.id, status: again.status, duplicate: true };
      }
      throw err;
    }
  }

  /** Copies the reported AI text; 404s unless the target really belongs to this session. */
  private async snapshot(sessionId: string, type: AiContentTarget, targetId: string): Promise<string> {
    const notFound = () => new NotFoundException('That AI response could not be found.');
    switch (type) {
      case AiContentTarget.ASSESSOR_TURN: {
        const turn = await this.prisma.sessionTurn.findFirst({
          where: { id: targetId, sessionId },
          select: { role: true, content: true },
        });
        // Only the AI's own turns are reportable here — never the candidate's.
        if (!turn || turn.role !== SessionTurnRole.ASSESSOR) throw notFound();
        return turn.content;
      }
      case AiContentTarget.LIVE_FEEDBACK: {
        const fb = await this.prisma.liveClaimFeedback.findFirst({ where: { id: targetId, sessionId } });
        if (!fb) throw notFound();
        // Generic copy of the row minus bookkeeping columns, so this stays
        // correct if LiveClaimFeedback gains or renames content fields.
        const { id: _id, sessionId: _s, createdAt: _c, updatedAt: _u, ...content } = fb as Record<string, unknown>;
        return JSON.stringify(content);
      }
      case AiContentTarget.RESULT_REASON: {
        if (!(Object.values(RagL2Claim) as string[]).includes(targetId)) throw notFound();
        const verdict = await this.prisma.claimVerdict.findFirst({
          where: { sessionId, claimId: targetId as RagL2Claim },
          select: { reason: true },
        });
        if (!verdict) throw notFound();
        return verdict.reason;
      }
      default:
        throw notFound();
    }
  }

  /** Admin queue, newest first. */
  list(status?: AiContentReportStatus) {
    return this.prisma.aiContentReport.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async markReviewed(id: string, adminUserId: string, resolutionNote?: string) {
    const existing = await this.prisma.aiContentReport.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Report not found.');
    return this.prisma.aiContentReport.update({
      where: { id },
      data: {
        status: AiContentReportStatus.REVIEWED,
        reviewedAt: new Date(),
        reviewedById: adminUserId,
        resolutionNote: resolutionNote?.trim() || null,
      },
    });
  }

  /** Called from account deletion: the candidate's own free text is the only personal data here. */
  clearNotesForUser(userId: string) {
    return this.prisma.aiContentReport.updateMany({ where: { userId }, data: { note: null } });
  }
}
