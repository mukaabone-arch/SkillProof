import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AssessmentSession,
  AssessmentSessionStatus,
  Prisma,
  ProbeRung,
  RagL2Claim,
  SessionTurn,
  SessionTurnRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssessorService, LadderState } from './assessor.service';
import { ScoringService } from './scoring.service';
import { CLAIM_ORDER, RUBRIC_VERSION, SCENARIO_BRIEF } from './rag-systems-l2.rubric';

/**
 * How long a session can sit idle (no candidate turn) before it's
 * considered interrupted. Deliberately shorter than the ~20 minute
 * end-to-end session length mentioned to candidates — this is an
 * inactivity guard, not a hard session-length cap.
 */
const IDLE_TIMEOUT_MINUTES = Number(process.env.ASSESSMENT_SESSION_IDLE_TIMEOUT_MINUTES) || 15;

export interface PublicTurn {
  id: string;
  role: SessionTurnRole;
  content: string;
  createdAt: Date;
}

function toPublicTurn(turn: SessionTurn): PublicTurn {
  return { id: turn.id, role: turn.role, content: turn.content, createdAt: turn.createdAt };
}

function deriveTarget(state: LadderState): { claimId: RagL2Claim | null; probeRung: ProbeRung | null } {
  if (state.stage === 'CLAIM') {
    return { claimId: CLAIM_ORDER[state.claimIndex], probeRung: state.rung };
  }
  return { claimId: null, probeRung: null };
}

/**
 * State machine for a conversational assessment session: creation (the
 * opening turn), each candidate turn triggering a ladder-progression turn,
 * lazy idle-expiry (same "check on every touching endpoint" pattern as
 * AssessmentsService.enforceDeadline), and resume-not-restart after an
 * interruption.
 */
@Injectable()
export class AssessmentSessionsService {
  private readonly logger = new Logger(AssessmentSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly assessor: AssessorService,
    private readonly scoring: ScoringService,
  ) {}

  /**
   * Idempotent: a candidate with an existing IN_PROGRESS or EXPIRED session
   * gets that same session back (with its transcript) rather than a second
   * one — mirrors AssessmentsService.startAttempt's "one active attempt"
   * pattern. Only a session already at AWAITING_SCORING allows a fresh one.
   */
  async createSession(userId: string): Promise<{ session: AssessmentSession; turns: PublicTurn[] }> {
    const existing = await this.prisma.assessmentSession.findFirst({
      where: { userId, status: { in: [AssessmentSessionStatus.IN_PROGRESS, AssessmentSessionStatus.EXPIRED] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const enforced = await this.enforceExpiry(existing);
      return { session: enforced, turns: await this.publicTurns(enforced.id) };
    }

    const opening = await this.assessor.generateOpeningTurn();
    const ladderState: LadderState = { stage: 'CLAIM', claimIndex: 0, rung: 'OPENING' };

    const session = await this.prisma.assessmentSession.create({
      data: {
        userId,
        status: AssessmentSessionStatus.IN_PROGRESS,
        pinnedBrief: SCENARIO_BRIEF,
        rubricVersion: RUBRIC_VERSION,
        ladderState: ladderState as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + IDLE_TIMEOUT_MINUTES * 60_000),
        turns: {
          create: {
            role: SessionTurnRole.ASSESSOR,
            content: opening.content,
            claimId: opening.claimId,
            probeRung: opening.probeRung,
          },
        },
      },
    });

    return { session, turns: await this.publicTurns(session.id) };
  }

  async getSession(userId: string, sessionId: string): Promise<{ session: AssessmentSession; turns: PublicTurn[] }> {
    let session = await this.getOwnedSession(userId, sessionId);
    session = await this.enforceExpiry(session);
    return { session, turns: await this.publicTurns(session.id) };
  }

  /**
   * Persists the candidate's answer, then generates and persists the next
   * assessor turn per the ladder logic in AssessorService.
   */
  async postTurn(
    userId: string,
    sessionId: string,
    content: string,
  ): Promise<{ candidateTurn: PublicTurn; assessorTurn: PublicTurn; session: AssessmentSession }> {
    let session = await this.getOwnedSession(userId, sessionId);
    session = await this.enforceExpiry(session);

    if (session.status === AssessmentSessionStatus.EXPIRED) {
      throw new BadRequestException('This session was interrupted — resume it before continuing.');
    }
    if (session.status === AssessmentSessionStatus.AWAITING_SCORING) {
      throw new BadRequestException('This session has already finished and is awaiting review.');
    }

    const ladderState = session.ladderState as unknown as LadderState;
    const target = deriveTarget(ladderState);

    const candidateTurn = await this.prisma.sessionTurn.create({
      data: {
        sessionId,
        role: SessionTurnRole.CANDIDATE,
        content,
        claimId: target.claimId,
        probeRung: target.probeRung,
      },
    });

    const history = await this.prisma.sessionTurn.findMany({
      where: { sessionId, superseded: false },
      orderBy: { createdAt: 'asc' },
    });

    const { turn, nextLadderState, completesSession } = await this.assessor.generateNextTurn(history, ladderState);

    const assessorTurn = await this.prisma.sessionTurn.create({
      data: {
        sessionId,
        role: SessionTurnRole.ASSESSOR,
        content: turn.content,
        claimId: turn.claimId,
        probeRung: turn.probeRung,
      },
    });

    session = await this.prisma.assessmentSession.update({
      where: { id: sessionId },
      data: {
        ladderState: nextLadderState as unknown as Prisma.InputJsonValue,
        status: completesSession ? AssessmentSessionStatus.AWAITING_SCORING : AssessmentSessionStatus.IN_PROGRESS,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + IDLE_TIMEOUT_MINUTES * 60_000),
      },
    });

    if (completesSession) {
      // Fire-and-forget: scoreSession persists its own success/failure state
      // (status -> AWAITING_REVIEW, or scoringError set while staying
      // AWAITING_SCORING) — this .catch only stops an unhandled rejection
      // from surfacing, it isn't the error-handling path.
      this.scoring.scoreSession(sessionId).catch((err: Error) => {
        this.logger.warn(`Fire-and-forget scoring failed for session ${sessionId}: ${err.message}`);
      });
    }

    return { candidateTurn: toPublicTurn(candidateTurn), assessorTurn: toPublicTurn(assessorTurn), session };
  }

  /**
   * Resume-not-restart: re-asks exactly the probe that was outstanding when
   * the session went idle (per ladderState, unchanged since the break), and
   * marks that original turn superseded so it drops out of both the
   * candidate transcript and the model's context on the next call.
   */
  async resume(userId: string, sessionId: string): Promise<{ turn: PublicTurn; session: AssessmentSession }> {
    let session = await this.getOwnedSession(userId, sessionId);
    session = await this.enforceExpiry(session);

    if (session.status !== AssessmentSessionStatus.EXPIRED) {
      throw new BadRequestException('This session is not currently interrupted.');
    }

    const ladderState = session.ladderState as unknown as LadderState;
    const turns = await this.prisma.sessionTurn.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });

    const fragment = [...turns].reverse().find((t) => t.role === SessionTurnRole.ASSESSOR && !t.superseded);
    if (fragment) {
      await this.prisma.sessionTurn.update({ where: { id: fragment.id }, data: { superseded: true } });
    }
    const history = turns.filter((t) => !t.superseded && t.id !== fragment?.id);

    const generated = await this.assessor.generateResumeTurn(history, ladderState);
    const target = deriveTarget(ladderState);
    const newTurn = await this.prisma.sessionTurn.create({
      data: {
        sessionId,
        role: SessionTurnRole.ASSESSOR,
        content: generated.content,
        claimId: target.claimId,
        probeRung: target.probeRung,
      },
    });

    session = await this.prisma.assessmentSession.update({
      where: { id: sessionId },
      data: {
        status: AssessmentSessionStatus.IN_PROGRESS,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + IDLE_TIMEOUT_MINUTES * 60_000),
      },
    });

    const openInterruption = await this.prisma.sessionInterruption.findFirst({
      where: { sessionId, resumedAt: null },
      orderBy: { occurredAt: 'desc' },
    });
    if (openInterruption) {
      await this.prisma.sessionInterruption.update({
        where: { id: openInterruption.id },
        data: { resumedAt: new Date(), fragmentTurnId: fragment?.id ?? null },
      });
    }

    return { turn: toPublicTurn(newTurn), session };
  }

  // ---------- helpers ----------

  private async getOwnedSession(userId: string, sessionId: string): Promise<AssessmentSession> {
    const session = await this.prisma.assessmentSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Assessment session not found');
    if (session.userId !== userId) throw new ForbiddenException();
    return session;
  }

  private async publicTurns(sessionId: string): Promise<PublicTurn[]> {
    const turns = await this.prisma.sessionTurn.findMany({
      where: { sessionId, superseded: false },
      orderBy: { createdAt: 'asc' },
    });
    return turns.map(toPublicTurn);
  }

  /**
   * Server-side-only idle check, mirroring AssessmentsService.enforceDeadline:
   * called at the top of every session-touching endpoint so expiry is
   * enforced no matter which one the client happens to call next. Logs a
   * SessionInterruption with resumedAt still null — resume() closes it out.
   */
  private async enforceExpiry(session: AssessmentSession): Promise<AssessmentSession> {
    if (session.status !== AssessmentSessionStatus.IN_PROGRESS) return session;
    if (Date.now() < session.expiresAt.getTime()) return session;

    this.logger.log(`Assessment session ${session.id} went idle past its expiry — marking EXPIRED`);
    await this.prisma.sessionInterruption.create({
      data: { sessionId: session.id, occurredAt: session.expiresAt },
    });
    return this.prisma.assessmentSession.update({
      where: { id: session.id },
      data: { status: AssessmentSessionStatus.EXPIRED },
    });
  }
}

