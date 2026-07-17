import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AssessmentSession,
  AssessmentSessionStatus,
  LiveClaimFeedback,
  Prisma,
  ProbeRung,
  RagL2Claim,
  SessionTurn,
  SessionTurnRole,
  Verdict,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssessorService, LadderState } from './assessor.service';
import { ScoringService } from './scoring.service';
import { LiveFeedbackService } from './live-feedback.service';
import { CLAIM_ORDER, RUBRIC_VERSION, SCENARIO_BRIEF, SKILL_LEVEL, SKILL_NAME } from './rag-systems-l2.rubric';
import { TurnSignalsDto } from './assessment-sessions.dto';

/**
 * The level rule (see ReviewService) only gates ISSUE eligibility on claims
 * 1-5 — COST doesn't gate. Reused here to compute the same "gates" flag and
 * the same INSUFFICIENT_PROBING special case for the candidate-facing
 * result payload. Small, deliberate duplication of ReviewService's
 * LEVEL_RULE_CLAIMS rather than a cross-service import for one constant.
 */
const GATING_CLAIMS: RagL2Claim[] = CLAIM_ORDER.slice(0, 5);

/**
 * True when a decision was blocked-then-rejected because the assessor
 * failed to elicit evidence on a gating claim — a verdict about the
 * session, not the candidate. Shared by createSession's cooldown check,
 * getMine, and getResult so all three agree on when a retake is immediate
 * and free vs. subject to the cooldown.
 */
function isInsufficientProbing(claimVerdicts: { claimId: RagL2Claim; reviewerVerdict: Verdict | null }[]): boolean {
  return claimVerdicts.some((v) => GATING_CLAIMS.includes(v.claimId) && v.reviewerVerdict === Verdict.INSUFFICIENT_PROBING);
}

/**
 * True once any of the session's disputes was resolved in the candidate's
 * favor — the reviewer's verdict was wrong, which (like INSUFFICIENT_PROBING)
 * is a fault of the process, not the candidate.
 */
function hasUpheldDispute(disputes: { upheld: boolean | null }[]): boolean {
  return disputes.some((d) => d.upheld === true);
}

/**
 * Combines both reasons a REJECTED session's retake cooldown doesn't apply.
 * Shared by createSession's cooldown check, getMine, and getResult so all
 * three agree on when a retake is immediate and free.
 */
function isRetakeCooldownExempt(
  claimVerdicts: { claimId: RagL2Claim; reviewerVerdict: Verdict | null }[],
  disputes: { upheld: boolean | null }[],
): boolean {
  return isInsufficientProbing(claimVerdicts) || hasUpheldDispute(disputes);
}

/**
 * Candidate-facing fallback when a claim has no reviewerNote — never falls
 * back to the model's own `reason` text (that's model-authored content, and
 * the whole point of this surface is "the reviewer verdicts are what
 * render, never the model columns"). A claim the reviewer agreed with the
 * model on typically has no note at all (only required on a >=2-band
 * disagreement — see ReviewService.reviewClaim), so this is the common case,
 * not an edge case.
 */
const VERDICT_FALLBACK_SENTENCE: Record<Verdict, string> = {
  [Verdict.DEMONSTRATED]: 'The reviewer confirmed this was clearly demonstrated.',
  [Verdict.PARTIAL]: 'The reviewer found this partially demonstrated.',
  [Verdict.NOT_EVIDENCED]: 'The reviewer did not find this demonstrated in the discussion.',
  [Verdict.ABSTAIN]: 'The reviewer could not find enough in the conversation to judge this either way.',
  [Verdict.INSUFFICIENT_PROBING]: 'The conversation did not sufficiently probe this area.',
};

const DECIDED_STATUSES: AssessmentSessionStatus[] = [
  AssessmentSessionStatus.ISSUED,
  AssessmentSessionStatus.REJECTED,
  AssessmentSessionStatus.DISPUTED,
];

/**
 * How long a session can sit idle (no candidate turn) before it's
 * considered interrupted. Deliberately shorter than the ~20 minute
 * end-to-end session length mentioned to candidates — this is an
 * inactivity guard, not a hard session-length cap. Exported so the
 * controller can surface the real value to the candidate (the exit
 * confirm's copy) rather than a hardcoded guess drifting out of sync.
 */
export const IDLE_TIMEOUT_MINUTES = Number(process.env.ASSESSMENT_SESSION_IDLE_TIMEOUT_MINUTES) || 15;

/**
 * How long a candidate must wait after a REJECTED decision before starting a
 * fresh session — see createSession's cooldown check and getMine/getResult's
 * retakeAvailableAt. Does not apply when the decision was blocked by
 * INSUFFICIENT_PROBING (see isInsufficientProbing) — that's on the assessor,
 * not the candidate, so that retake is immediate and free. Env-overridable
 * so it can be flipped to 0 for local testing without a code change.
 */
const RETAKE_COOLDOWN_DAYS = Number(process.env.ASSESSMENT_RETAKE_COOLDOWN_DAYS) || 14;

export interface PublicTurn {
  id: string;
  role: SessionTurnRole;
  content: string;
  // Included (not filtered out) so the candidate-facing UI can render a
  // struck-through "re-asked after a connection drop" fragment — see
  // publicTurns below. probeRung is still never exposed: which rung
  // (opening/followup/constraint) a turn targeted would reveal the ladder
  // structure. claimId is the one exception, exposed only so the session
  // page can group turns into per-topic cards and line them up with
  // LiveClaimFeedback (which already carries claimId for the same reason)
  // — it's an opaque enum value, never the claim's rubric label/hints.
  claimId: RagL2Claim | null;
  superseded: boolean;
  createdAt: Date;
}

function toPublicTurn(turn: SessionTurn): PublicTurn {
  return { id: turn.id, role: turn.role, content: turn.content, claimId: turn.claimId, superseded: turn.superseded, createdAt: turn.createdAt };
}

function deriveTarget(state: LadderState): { claimId: RagL2Claim | null; probeRung: ProbeRung | null } {
  if (state.stage === 'CLAIM') {
    return { claimId: CLAIM_ORDER[state.claimIndex], probeRung: state.rung };
  }
  return { claimId: null, probeRung: null };
}

/**
 * Candidate-facing shape of a LiveClaimFeedback row — see that model's own
 * doc comment. strengths/gaps are stored as Json (string[]) and cast back
 * out here rather than at every call site.
 */
export interface PublicLiveFeedback {
  id: string;
  claimId: RagL2Claim;
  verdictLabel: string;
  summary: string;
  strengths: string[];
  gaps: string[];
  helpfulVote: boolean | null;
}

function toPublicLiveFeedback(row: LiveClaimFeedback): PublicLiveFeedback {
  return {
    id: row.id,
    claimId: row.claimId,
    verdictLabel: row.verdictLabel,
    summary: row.summary,
    strengths: row.strengths as string[],
    gaps: row.gaps as string[],
    helpfulVote: row.helpfulVote,
  };
}

/**
 * Candidate-facing "Q x/6" progress — counts scored claims only. Reflection
 * questions aren't numbered separately (the session page renders them as
 * plain follow-up turns, not their own question card), so progress caps at
 * 6/6 once the ladder leaves the claim stage.
 */
export function computeProgress(ladderState: LadderState): { current: number; total: number } {
  const total = CLAIM_ORDER.length;
  if (ladderState.stage === 'CLAIM') {
    return { current: Math.min(ladderState.claimIndex + 1, total), total };
  }
  return { current: total, total };
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
    private readonly liveFeedback: LiveFeedbackService,
  ) {}

  /**
   * Idempotent: a candidate with an existing IN_PROGRESS or EXPIRED session
   * gets that same session back (with its transcript) rather than a second
   * one — mirrors AssessmentsService.startAttempt's "one active attempt"
   * pattern. Only a session already at AWAITING_SCORING allows a fresh one.
   */
  async createSession(userId: string): Promise<{ session: AssessmentSession; turns: PublicTurn[]; claimFeedback: PublicLiveFeedback[] }> {
    const existing = await this.prisma.assessmentSession.findFirst({
      where: { userId, status: { in: [AssessmentSessionStatus.IN_PROGRESS, AssessmentSessionStatus.EXPIRED] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const enforced = await this.enforceExpiry(existing);
      return { session: enforced, turns: await this.publicTurns(enforced.id), claimFeedback: await this.publicLiveFeedback(enforced.id) };
    }

    // Retake gate — looks at the most recently decided REJECTED-or-DISPUTED
    // session (disputing never touches decidedAt, so "most recent" and the
    // cooldown math both still key off the *original* decision). A DISPUTED
    // session blocks a retake outright: no cooldown math applies while a
    // dispute is still open, since there's no decided outcome yet to cool
    // down from. A plain REJECTED decision is cooldown-gated unless exempt —
    // INSUFFICIENT_PROBING or an upheld dispute (both faults of the process,
    // not the candidate) grant an immediate, free retake. The disabled
    // button on the client is UX; this 409 is the actual rule, in case of a
    // stale page or a directly-hit API call.
    const lastDecided = await this.prisma.assessmentSession.findFirst({
      where: { userId, status: { in: [AssessmentSessionStatus.REJECTED, AssessmentSessionStatus.DISPUTED] } },
      orderBy: { decidedAt: 'desc' },
      include: { claimVerdicts: true, disputes: true },
    });
    if (lastDecided?.status === AssessmentSessionStatus.DISPUTED) {
      throw new ConflictException({
        message: 'A dispute on your last session is still under review.',
        reason: 'DISPUTE_PENDING',
      });
    }
    if (lastDecided?.decidedAt && !isRetakeCooldownExempt(lastDecided.claimVerdicts, lastDecided.disputes)) {
      const retakeAvailableAt = new Date(lastDecided.decidedAt.getTime() + RETAKE_COOLDOWN_DAYS * 86_400_000);
      if (Date.now() < retakeAvailableAt.getTime()) {
        throw new ConflictException({
          message: `Retake available from ${retakeAvailableAt.toISOString()}`,
          retakeAvailableAt: retakeAvailableAt.toISOString(),
        });
      }
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

    return { session, turns: await this.publicTurns(session.id), claimFeedback: [] };
  }

  async getSession(
    userId: string,
    sessionId: string,
  ): Promise<{ session: AssessmentSession; turns: PublicTurn[]; claimFeedback: PublicLiveFeedback[] }> {
    let session = await this.getOwnedSession(userId, sessionId);
    session = await this.enforceExpiry(session);
    return { session, turns: await this.publicTurns(session.id), claimFeedback: await this.publicLiveFeedback(session.id) };
  }

  /**
   * Persists the candidate's answer, then generates and persists the next
   * assessor turn per the ladder logic in AssessorService.
   */
  async postTurn(
    userId: string,
    sessionId: string,
    content: string,
    signals?: TurnSignalsDto,
  ): Promise<{ candidateTurn: PublicTurn; assessorTurn: PublicTurn; session: AssessmentSession; liveFeedback: PublicLiveFeedback | null }> {
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

    // Best-effort, silent — a client that sends no signals (or a partial
    // set) is normal and must never affect turn submission. Never read by
    // AssessorService (the `history` query two lines down is a plain
    // findMany with no relation include) or by ScoringService — see that
    // service's own note on this.
    if (signals && Object.values(signals).some((v) => v !== undefined)) {
      await this.prisma.turnSignals
        .create({ data: { sessionTurnId: candidateTurn.id, ...signals } })
        .catch((err: Error) => this.logger.warn(`Failed to persist turn signals for turn ${candidateTurn.id}: ${err.message}`));
    }

    const history = await this.prisma.sessionTurn.findMany({
      where: { sessionId, superseded: false },
      orderBy: { createdAt: 'asc' },
    });

    // CONSTRAINT is always a claim's last rung, so the candidate turn just
    // persisted above completes claim.claimId's exchange regardless of
    // what the ladder moves to next — generate its live coaching note now.
    // Awaited inline (not fire-and-forget like scoring) since the candidate
    // needs it in this same response; generateClaimFeedback never throws,
    // so a failure here just yields liveFeedback: null.
    let liveFeedback: PublicLiveFeedback | null = null;
    if (target.probeRung === ProbeRung.CONSTRAINT && target.claimId) {
      const claimTurns = history.filter((t) => t.claimId === target.claimId);
      const generated = await this.liveFeedback.generateClaimFeedback(target.claimId, claimTurns);
      if (generated) {
        const row = await this.prisma.liveClaimFeedback.upsert({
          where: { sessionId_claimId: { sessionId, claimId: target.claimId } },
          create: {
            sessionId,
            claimId: target.claimId,
            verdictLabel: generated.verdictLabel,
            summary: generated.summary,
            strengths: generated.strengths as unknown as Prisma.InputJsonValue,
            gaps: generated.gaps as unknown as Prisma.InputJsonValue,
          },
          update: {
            verdictLabel: generated.verdictLabel,
            summary: generated.summary,
            strengths: generated.strengths as unknown as Prisma.InputJsonValue,
            gaps: generated.gaps as unknown as Prisma.InputJsonValue,
          },
        });
        liveFeedback = toPublicLiveFeedback(row);
      }
    }

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

    return { candidateTurn: toPublicTurn(candidateTurn), assessorTurn: toPublicTurn(assessorTurn), session, liveFeedback };
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

  /**
   * GET /assessment-sessions/mine — the candidate's most recent session
   * (any status), or null. Lets the pre-session and catalog pages decide
   * Start vs. Resume vs. "In review" vs. a result link *before* the
   * candidate commits to an action, without needing to know a session id
   * up front. This system only ever assesses one skill/level today, so
   * "most recent" is unambiguous; a multi-skill future would need a
   * skill/level filter here.
   */
  async getMine(userId: string) {
    const session = await this.prisma.assessmentSession.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { claimVerdicts: true, disputes: true },
    });
    if (!session) return null;

    // insufficientProbing keeps its narrow, original meaning (drives the
    // "didn't give you a fair shot" copy specifically) — retakeAvailableAt
    // below uses the broader isRetakeCooldownExempt so an upheld dispute
    // also clears the cooldown, just without that specific copy: the client
    // sees a null retakeAvailableAt and falls through to a plain, enabled
    // "Retake assessment" button.
    const insufficientProbing = isInsufficientProbing(session.claimVerdicts);
    const retakeAvailableAt =
      session.status === AssessmentSessionStatus.REJECTED &&
      !isRetakeCooldownExempt(session.claimVerdicts, session.disputes) &&
      session.decidedAt
        ? new Date(session.decidedAt.getTime() + RETAKE_COOLDOWN_DAYS * 86_400_000)
        : null;

    return { id: session.id, status: session.status, insufficientProbing, retakeAvailableAt };
  }

  /**
   * GET /assessment-sessions/:id/result — candidate-scoped, own session
   * only (404 otherwise), and only once decided (404 before that — a
   * candidate must not be able to distinguish AWAITING_SCORING from
   * AWAITING_REVIEW from this endpoint, since neither carries a result yet).
   * Renders only the reviewer's own verdicts/reasoning — modelVerdict/
   * modelReason never leave ReviewService. An INSUFFICIENT_PROBING verdict
   * on any gating claim short-circuits into a distinct "didn't give you a
   * fair chance" payload with no per-claim verdicts at all, regardless of
   * whether the session ended up ISSUED (shouldn't happen — decide() blocks
   * that) or REJECTED/DISPUTED.
   */
  async getResult(userId: string, sessionId: string) {
    const session = await this.prisma.assessmentSession.findUnique({
      where: { id: sessionId },
      include: { claimVerdicts: true, disputes: true, badge: true },
    });
    if (!session || session.userId !== userId) throw new NotFoundException('Assessment session not found');
    if (!DECIDED_STATUSES.includes(session.status)) {
      throw new NotFoundException('This session has not been decided yet.');
    }

    if (isInsufficientProbing(session.claimVerdicts)) {
      return {
        sessionId: session.id,
        status: session.status,
        outcome: 'INSUFFICIENT_PROBING' as const,
        skill: SKILL_NAME,
        level: SKILL_LEVEL,
        // Immediate and free — no cooldown when the assessor is at fault.
        retakeAvailableAt: null,
      };
    }

    const claims = CLAIM_ORDER.map((claimId) => {
      const v = session.claimVerdicts.find((c) => c.claimId === claimId)!;
      const dispute = session.disputes.find((d) => d.claimId === claimId) ?? null;
      const verdict = v.reviewerVerdict as Verdict;
      return {
        claimId,
        verdict,
        reason: v.reviewerNote?.trim() ? v.reviewerNote : VERDICT_FALLBACK_SENTENCE[verdict],
        gates: GATING_CLAIMS.includes(claimId),
        disputed: !!dispute,
        disputeResolved: dispute?.resolvedAt != null,
      };
    });

    return {
      sessionId: session.id,
      status: session.status,
      outcome: (session.status === AssessmentSessionStatus.ISSUED
        ? 'ISSUED'
        : session.status === AssessmentSessionStatus.DISPUTED
          ? 'DISPUTED'
          : 'REJECTED') as 'ISSUED' | 'REJECTED' | 'DISPUTED',
      skill: SKILL_NAME,
      level: SKILL_LEVEL,
      decidedAt: session.decidedAt,
      decisionNote: session.decisionNote,
      // Only meaningful for a plain REJECTED outcome — ISSUED has nothing to
      // retake, and DISPUTED blocks a retake outright (see createSession),
      // so there's no date to show while it's still unresolved. null here
      // also covers an upheld-dispute exemption, same as insufficientProbing
      // — the client falls through to a plain enabled retake button.
      retakeAvailableAt:
        session.status === AssessmentSessionStatus.REJECTED &&
        session.decidedAt &&
        !isRetakeCooldownExempt(session.claimVerdicts, session.disputes)
          ? new Date(session.decidedAt.getTime() + RETAKE_COOLDOWN_DAYS * 86_400_000)
          : null,
      claims,
      badge: session.badge
        ? { verifyHash: session.badge.verifyHash, level: session.badge.level, expiresAt: session.badge.expiresAt }
        : null,
      transcript: await this.publicTurns(sessionId),
    };
  }

  /**
   * POST /assessment-sessions/:id/claims/:claimId/dispute — one dispute per
   * claim (409 on a second attempt against the same claim; a mistaken or
   * incomplete dispute needs a human to sort out, same write-once spirit as
   * ReviewService.reviewClaim). Flips the session to DISPUTED, which folds
   * it back into the admin review queue as a flagged case.
   */
  async disputeClaim(userId: string, sessionId: string, claimId: string, body: string) {
    const session = await this.getOwnedSession(userId, sessionId);
    if (!DECIDED_STATUSES.includes(session.status)) {
      throw new NotFoundException('This session has not been decided yet.');
    }
    if (!CLAIM_ORDER.includes(claimId as RagL2Claim)) {
      throw new BadRequestException(`Unknown claim "${claimId}".`);
    }

    const existing = await this.prisma.claimDispute.findUnique({
      where: { sessionId_claimId: { sessionId, claimId: claimId as RagL2Claim } },
    });
    if (existing) {
      throw new ConflictException('You have already disputed this claim.');
    }

    const dispute = await this.prisma.claimDispute.create({
      data: { sessionId, claimId: claimId as RagL2Claim, candidateId: userId, body },
    });
    await this.prisma.assessmentSession.update({
      where: { id: sessionId },
      data: {
        status: AssessmentSessionStatus.DISPUTED,
        // Only stash on the *first* dispute against this session — a second
        // dispute (different claim) while already DISPUTED must not
        // overwrite it with DISPUTED itself.
        ...(session.status !== AssessmentSessionStatus.DISPUTED ? { preDisputeStatus: session.status } : {}),
      },
    });

    return { claimId: dispute.claimId, disputed: true, createdAt: dispute.createdAt };
  }

  /**
   * Admin-only: closes the loop on one claim's dispute (write-once — 409 if
   * already resolved). Once no disputes remain unresolved on the session,
   * reverts status back to preDisputeStatus — never to AWAITING_REVIEW/
   * AWAITING_SCORING, so a decided session is never reopened for rescoring.
   * decidedAt is never touched here (or anywhere in the dispute flow), so
   * the retake cooldown computed from it is unaffected by how long the
   * dispute took to resolve. An upheld dispute doesn't itself change any
   * ClaimVerdict — it only exempts the reverted-to REJECTED session from
   * the retake cooldown (see isRetakeCooldownExempt), the same no-fault
   * treatment as INSUFFICIENT_PROBING.
   */
  async resolveDispute(sessionId: string, claimId: string, upheld: boolean, resolution: string) {
    if (!CLAIM_ORDER.includes(claimId as RagL2Claim)) {
      throw new BadRequestException(`Unknown claim "${claimId}".`);
    }
    const dispute = await this.prisma.claimDispute.findUnique({
      where: { sessionId_claimId: { sessionId, claimId: claimId as RagL2Claim } },
    });
    if (!dispute) {
      throw new NotFoundException('No dispute found for this claim.');
    }
    if (dispute.resolvedAt) {
      throw new ConflictException('This dispute has already been resolved.');
    }

    await this.prisma.claimDispute.update({
      where: { id: dispute.id },
      data: { resolvedAt: new Date(), resolution, upheld },
    });

    const session = await this.prisma.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
    const stillUnresolved = await this.prisma.claimDispute.count({
      where: { sessionId, resolvedAt: null },
    });
    if (stillUnresolved === 0 && session.status === AssessmentSessionStatus.DISPUTED && session.preDisputeStatus) {
      await this.prisma.assessmentSession.update({
        where: { id: sessionId },
        data: { status: session.preDisputeStatus, preDisputeStatus: null },
      });
    }

    return { claimId: dispute.claimId, upheld, resolvedAt: new Date() };
  }

  /**
   * POST /assessment-sessions/:id/claims/:claimId/feedback-vote —
   * upsertable "was this helpful" vote on one claim's live feedback.
   * Unlike ClaimDispute this is a low-stakes UI toggle, not write-once: a
   * candidate can change their mind. 404 if that claim has no live
   * feedback yet (e.g. the claim isn't complete, or generation failed).
   */
  async voteLiveFeedback(userId: string, sessionId: string, claimId: string, helpful: boolean): Promise<{ claimId: string; helpful: boolean }> {
    await this.getOwnedSession(userId, sessionId);
    if (!CLAIM_ORDER.includes(claimId as RagL2Claim)) {
      throw new BadRequestException(`Unknown claim "${claimId}".`);
    }

    const existing = await this.prisma.liveClaimFeedback.findUnique({
      where: { sessionId_claimId: { sessionId, claimId: claimId as RagL2Claim } },
    });
    if (!existing) {
      throw new NotFoundException('No live feedback found for this claim.');
    }

    await this.prisma.liveClaimFeedback.update({
      where: { id: existing.id },
      data: { helpfulVote: helpful, votedAt: new Date() },
    });

    return { claimId, helpful };
  }

  /**
   * Active working time as of now: wall clock since startedAt, minus every
   * logged interruption gap (occurredAt -> resumedAt). occurredAt is
   * already anchored to the real idle boundary (enforceExpiry sets it to
   * the session's expiresAt at the moment it lapsed, not to whenever the
   * check happened to run), so a candidate who doesn't touch the app again
   * for hours doesn't inflate the gap. An unresumed (open) interruption
   * subtracts all the way to now, which freezes the count for as long as
   * the gap stays open — exactly right, since resume-not-restart means the
   * candidate wasn't doing anything during that stretch.
   *
   * Deliberately excludes only *this*: normal thinking/typing time between
   * turns within an active stretch is real working time and stays counted,
   * no matter how long a single reply takes, as long as it's under
   * IDLE_TIMEOUT_MINUTES.
   *
   * Returned as a snapshot; the client anchors its own per-second tick to
   * this value plus wall-clock time elapsed since the response arrived,
   * rather than recomputing from startedAt (see the session page — that
   * recomputation is exactly today's bug).
   */
  async computeElapsedSeconds(sessionId: string, startedAt: Date): Promise<number> {
    const interruptions = await this.prisma.sessionInterruption.findMany({ where: { sessionId } });
    const now = Date.now();
    const totalMs = now - startedAt.getTime();
    const gapMs = interruptions.reduce(
      (sum, i) => sum + ((i.resumedAt?.getTime() ?? now) - i.occurredAt.getTime()),
      0,
    );
    return Math.max(0, Math.round((totalMs - gapMs) / 1000));
  }

  // ---------- helpers ----------

  /**
   * 404 (not 403) on a userId mismatch — confirming a session's *existence*
   * to a non-owner via a 403 is itself a minor information leak. Every
   * candidate-facing lookup in this service goes through here, so this one
   * change is what makes "another candidate's token 404s on someone else's
   * session" true everywhere at once.
   */
  private async getOwnedSession(userId: string, sessionId: string): Promise<AssessmentSession> {
    const session = await this.prisma.assessmentSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('Assessment session not found');
    return session;
  }

  /**
   * All turns, superseded ones included — the candidate is entitled to see
   * that a probe was re-asked after a connection drop (struck through in
   * the UI), just never the claimId/probeRung/reflection structure behind it.
   */
  private async publicTurns(sessionId: string): Promise<PublicTurn[]> {
    const turns = await this.prisma.sessionTurn.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return turns.map(toPublicTurn);
  }

  private async publicLiveFeedback(sessionId: string): Promise<PublicLiveFeedback[]> {
    const rows = await this.prisma.liveClaimFeedback.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toPublicLiveFeedback);
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

