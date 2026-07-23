import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  InterviewAnswerFeedback,
  InterviewQuestionCategory,
  InterviewSession,
  InterviewSessionPhase,
  InterviewSessionStatus,
  InterviewTurn,
  InterviewTurnRole,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { InterviewFeedbackService } from './interview-feedback.service';
import { InterviewQuestionSelectorService } from './interview-question-selector.service';
import { chooseFollowUp, followUpTemplate } from './follow-up-heuristics';
import {
  advanceState,
  capExceeded,
  computeProgress,
  initialPhaseState,
  InterviewPhaseState,
  isFollowUpEligiblePhase,
  pickBehavioralCategories,
} from './interview-orchestrator';
import {
  behavioralTransition,
  candidateQuestionsAck,
  candidateQuestionsInvite,
  CLOSING_MESSAGE,
  industryAwarenessTransition,
  motivationTransition,
  OPENING_MESSAGE,
} from './interview.constants';

/** Idle-timeout boundary — same "resume, don't restart" role as
 * AssessmentSessionsService.IDLE_TIMEOUT_MINUTES. Independent of the hard
 * turn/duration caps in interview-orchestrator.ts. */
export const IDLE_TIMEOUT_MINUTES = Number(process.env.INTERVIEW_SESSION_IDLE_TIMEOUT_MINUTES) || 15;

const ACTIVE_STATUSES: InterviewSessionStatus[] = [InterviewSessionStatus.IN_PROGRESS, InterviewSessionStatus.EXPIRED];

export interface PublicTurn {
  id: string;
  role: InterviewTurnRole;
  content: string;
  phase: InterviewSessionPhase;
  questionId: string | null;
  superseded: boolean;
  createdAt: Date;
}

function toPublicTurn(turn: InterviewTurn): PublicTurn {
  return {
    id: turn.id,
    role: turn.role,
    content: turn.content,
    phase: turn.phase,
    questionId: turn.questionId,
    superseded: turn.superseded,
    createdAt: turn.createdAt,
  };
}

interface Grounding {
  applicationId: string;
  orgName: string;
  jobTitle: string;
}

/**
 * Orchestrator for mock-interview coaching sessions — this is coaching,
 * not assessment. Deliberately separate from AssessmentSessionsService:
 * nothing here ever touches SkillClaim/Badge, never feeds scoring.ts or
 * matching.service.ts, and no human review step exists (there's no verdict
 * to review — see InterviewFeedbackService for the coaching feedback pass).
 * That isolation is what protects the credibility of verified badges with
 * employers.
 *
 * State machine, not free-form chat: an explicit InterviewPhaseState (see
 * interview-orchestrator.ts) the orchestrator alone advances — the LLM is
 * only ever asked to phrase language within a phase/question the
 * orchestrator already picked, mirroring AssessmentSessionsModule's
 * ladder/LadderState split between AssessmentSessionsService (decides) and
 * AssessorService (phrases).
 */
@Injectable()
export class InterviewSessionsService {
  private readonly logger = new Logger(InterviewSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly feedback: InterviewFeedbackService,
    private readonly questionSelector: InterviewQuestionSelectorService,
  ) {}

  /**
   * Idempotent: an existing IN_PROGRESS or EXPIRED session is returned
   * as-is, same "one active session" contract as
   * AssessmentSessionsService.createSession. applicationId is optional —
   * omitted, it falls back to the candidate's own most recent application;
   * no application at all just means the session isn't company-grounded
   * (see resolveGrounding), never an error.
   */
  async createSession(userId: string, applicationId?: string): Promise<{ session: InterviewSession; turns: PublicTurn[] }> {
    const existing = await this.prisma.interviewSession.findFirst({
      where: { userId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const enforced = await this.enforceExpiry(existing);
      return { session: enforced, turns: await this.publicTurns(enforced.id) };
    }

    const grounding = await this.resolveGrounding(userId, applicationId);
    const behavioralCategories = pickBehavioralCategories();
    const phaseState = initialPhaseState(behavioralCategories);

    const session = await this.prisma.interviewSession.create({
      data: {
        userId,
        applicationId: grounding?.applicationId ?? null,
        status: InterviewSessionStatus.IN_PROGRESS,
        phaseState: phaseState as unknown as Prisma.InputJsonValue,
        turnCount: 1,
        expiresAt: new Date(Date.now() + IDLE_TIMEOUT_MINUTES * 60_000),
        turns: {
          create: {
            role: InterviewTurnRole.COACH,
            content: OPENING_MESSAGE,
            phase: InterviewSessionPhase.OPENING,
          },
        },
      },
    });

    return { session, turns: await this.publicTurns(session.id) };
  }

  async getSession(userId: string, sessionId: string): Promise<{ session: InterviewSession; turns: PublicTurn[] }> {
    let session = await this.getOwnedSession(userId, sessionId);
    session = await this.enforceExpiry(session);
    return { session, turns: await this.publicTurns(session.id) };
  }

  /**
   * Persists the candidate's answer, then decides (via the pure
   * orchestrator) and generates the next coach turn. Questions always come
   * from the database, verbatim — the model is never asked to phrase or
   * paraphrase a bank question, only the connective transitions and the
   * rare LLM-chosen follow-up (see follow-up-heuristics.ts).
   */
  async postTurn(userId: string, sessionId: string, content: string): Promise<{ candidateTurn: PublicTurn; coachTurn: PublicTurn; session: InterviewSession }> {
    let session = await this.getOwnedSession(userId, sessionId);
    session = await this.enforceExpiry(session);

    if (session.status === InterviewSessionStatus.EXPIRED) {
      throw new BadRequestException('This session was interrupted — resume it before continuing.');
    }
    if (session.status !== InterviewSessionStatus.IN_PROGRESS) {
      throw new BadRequestException('This session has already finished.');
    }

    const state = session.phaseState as unknown as InterviewPhaseState;

    const candidateTurn = await this.prisma.interviewTurn.create({
      data: {
        sessionId,
        role: InterviewTurnRole.CANDIDATE,
        content,
        phase: state.phase,
        questionId: state.currentQuestionId,
      },
    });

    const turnCountAfterCandidate = session.turnCount + 1;
    const elapsedMs = Date.now() - session.startedAt.getTime();
    const grounding = await this.resolveGrounding(userId, undefined, session.applicationId);

    const { content: coachContent, nextState, completesSession } = await this.decideNextTurn(
      state,
      content,
      turnCountAfterCandidate,
      elapsedMs,
      grounding,
    );

    const coachTurn = await this.prisma.interviewTurn.create({
      data: {
        sessionId,
        role: InterviewTurnRole.COACH,
        content: coachContent,
        phase: nextState.phase === InterviewSessionPhase.SCORING ? InterviewSessionPhase.CLOSING : nextState.phase,
        questionId: nextState.currentQuestionId,
      },
    });

    session = await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        phaseState: nextState as unknown as Prisma.InputJsonValue,
        turnCount: turnCountAfterCandidate + 1,
        status: completesSession ? InterviewSessionStatus.AWAITING_FEEDBACK : InterviewSessionStatus.IN_PROGRESS,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + IDLE_TIMEOUT_MINUTES * 60_000),
      },
    });

    if (completesSession) {
      // Fire-and-forget: generateFeedbackForSession persists its own
      // success/failure state — this .catch only stops an unhandled
      // rejection from surfacing, it isn't the error-handling path.
      this.feedback.generateFeedbackForSession(sessionId).catch((err: Error) => {
        this.logger.warn(`Fire-and-forget feedback generation failed for session ${sessionId}: ${err.message}`);
      });
    }

    return { candidateTurn: toPublicTurn(candidateTurn), coachTurn: toPublicTurn(coachTurn), session };
  }

  /**
   * The orchestration core: given the phase the candidate just answered in,
   * decides what the coach says next and where the state moves to. Every
   * branch either reads a question verbatim from the database or uses a
   * fixed template (see interview.constants.ts) — the only model call in
   * this whole method is the rare LLM_CHOICE follow-up fallback.
   */
  private async decideNextTurn(
    state: InterviewPhaseState,
    answer: string,
    turnCount: number,
    elapsedMs: number,
    grounding: Grounding | null,
  ): Promise<{ content: string; nextState: InterviewPhaseState; completesSession: boolean }> {
    if (capExceeded(state, turnCount, elapsedMs)) {
      return this.moveToClosing(state);
    }

    if (state.phase === InterviewSessionPhase.OPENING) {
      const advanced = advanceState(state);
      return this.enterPhase(advanced, InterviewSessionPhase.OPENING, grounding);
    }

    if (state.phase === InterviewSessionPhase.CANDIDATE_QUESTIONS) {
      const advanced = advanceState(state);
      const ack = candidateQuestionsAck();
      return { content: `${ack}\n\n${CLOSING_MESSAGE}`, nextState: { ...advanced, phase: InterviewSessionPhase.SCORING }, completesSession: true };
    }

    if (isFollowUpEligiblePhase(state.phase) && !state.followUpAsked) {
      const decision = chooseFollowUp(answer);
      if (decision !== 'NONE') {
        const followUpContent =
          decision === 'LLM_CHOICE' ? await this.generateLlmFollowUp(state, answer) : followUpTemplate(decision);
        return { content: followUpContent, nextState: { ...state, followUpAsked: true }, completesSession: false };
      }
    }

    // Either the follow-up was already used, or the heuristics found
    // nothing to probe — this question is done.
    const advanced = advanceState(state);
    return this.enterPhase(advanced, state.phase, grounding);
  }

  /** Force-ends the session regardless of current phase — the turn/duration cap was hit. */
  private moveToClosing(state: InterviewPhaseState): { content: string; nextState: InterviewPhaseState; completesSession: boolean } {
    return {
      content: CLOSING_MESSAGE,
      nextState: { ...state, phase: InterviewSessionPhase.SCORING, followUpAsked: false, currentQuestionId: null },
      completesSession: true,
    };
  }

  /**
   * Generates the coach message for freshly entering `advanced.phase`,
   * having just left `fromPhase`. Bank-question phases pick and record a
   * question (never repeating one already asked this session);
   * CANDIDATE_QUESTIONS/CLOSING use a fixed, possibly grounding-aware,
   * template.
   */
  private async enterPhase(
    advanced: InterviewPhaseState,
    fromPhase: InterviewSessionPhase,
    grounding: Grounding | null,
  ): Promise<{ content: string; nextState: InterviewPhaseState; completesSession: boolean }> {
    switch (advanced.phase) {
      case InterviewSessionPhase.MOTIVATION: {
        const question = await this.mustPickQuestion(InterviewQuestionCategory.MOTIVATION, advanced, grounding);
        return {
          content: `${motivationTransition()}\n\n${question.text}`,
          nextState: this.withQuestion(advanced, question.id),
          completesSession: false,
        };
      }
      case InterviewSessionPhase.BEHAVIORAL: {
        const category = advanced.behavioralCategories[advanced.behavioralIndex];
        const question = await this.mustPickQuestion(category, advanced, grounding);
        const transition = fromPhase === InterviewSessionPhase.MOTIVATION ? behavioralTransition() : "Let's talk about something else.";
        return {
          content: `${transition}\n\n${question.text}`,
          nextState: this.withQuestion(advanced, question.id),
          completesSession: false,
        };
      }
      case InterviewSessionPhase.INDUSTRY_AWARENESS: {
        const question = await this.mustPickQuestion(InterviewQuestionCategory.INDUSTRY_AWARENESS, advanced, grounding);
        return {
          content: `${industryAwarenessTransition()}\n\n${question.text}`,
          nextState: this.withQuestion(advanced, question.id),
          completesSession: false,
        };
      }
      case InterviewSessionPhase.CANDIDATE_QUESTIONS:
        return {
          content: candidateQuestionsInvite(Math.random, grounding),
          nextState: advanced,
          completesSession: false,
        };
      case InterviewSessionPhase.CLOSING:
        return { content: CLOSING_MESSAGE, nextState: { ...advanced, phase: InterviewSessionPhase.SCORING }, completesSession: true };
      default:
        // OPENING/SCORING never reached via enterPhase — advanceState never returns OPENING, and SCORING is handled by its own callers.
        throw new Error(`Unexpected phase entered: ${advanced.phase}`);
    }
  }

  private withQuestion(state: InterviewPhaseState, questionId: string): InterviewPhaseState {
    return { ...state, currentQuestionId: questionId, askedQuestionIds: [...state.askedQuestionIds, questionId] };
  }

  private async mustPickQuestion(category: InterviewQuestionCategory, state: InterviewPhaseState, grounding: Grounding | null) {
    const question = await this.questionSelector.pickQuestion(category, state.askedQuestionIds, grounding !== null);
    if (!question) {
      // Bank exhausted for this category (shouldn't happen at the seeded
      // bank's size against one session's ~1 pick per category) — fail
      // loudly rather than silently asking a stale/repeated question.
      throw new Error(`No active interview question available for category ${category}.`);
    }
    return question;
  }

  private async generateLlmFollowUp(state: InterviewPhaseState, answer: string): Promise<string> {
    if (!state.currentQuestionId) return followUpTemplate('DETAIL');
    const question = await this.prisma.interviewQuestion.findUnique({ where: { id: state.currentQuestionId } });
    if (!question) return followUpTemplate('DETAIL');
    try {
      return await this.llm.generateInterviewFollowUp(question.text, answer);
    } catch (err) {
      this.logger.warn(`LLM follow-up generation failed, falling back to a templated probe: ${(err as Error).message}`);
      return followUpTemplate('DETAIL');
    }
  }

  /**
   * Resume-not-restart: the idle-timeout equivalent of
   * AssessmentSessionsService.resume. Re-sends the exact fragment that was
   * outstanding when the session went idle — never re-derives it, since
   * the phaseState (currentQuestionId, phase) hasn't moved.
   */
  async resume(userId: string, sessionId: string): Promise<{ turn: PublicTurn; session: InterviewSession }> {
    let session = await this.getOwnedSession(userId, sessionId);
    session = await this.enforceExpiry(session);

    if (session.status !== InterviewSessionStatus.EXPIRED) {
      throw new BadRequestException('This session is not currently interrupted.');
    }

    const turns = await this.prisma.interviewTurn.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    const fragment = [...turns].reverse().find((t) => t.role === InterviewTurnRole.COACH && !t.superseded);
    if (fragment) {
      await this.prisma.interviewTurn.update({ where: { id: fragment.id }, data: { superseded: true } });
    }

    const state = session.phaseState as unknown as InterviewPhaseState;
    const resumeContent = `Sorry about that — picking back up. ${fragment?.content ?? ''}`.trim();

    const newTurn = await this.prisma.interviewTurn.create({
      data: {
        sessionId,
        role: InterviewTurnRole.COACH,
        content: resumeContent,
        phase: state.phase,
        questionId: state.currentQuestionId,
      },
    });

    session = await this.prisma.interviewSession.update({
      where: { id: sessionId },
      data: {
        status: InterviewSessionStatus.IN_PROGRESS,
        turnCount: session.turnCount + 1,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + IDLE_TIMEOUT_MINUTES * 60_000),
      },
    });

    return { turn: toPublicTurn(newTurn), session };
  }

  /** GET /interview-sessions/mine — the candidate's most recent session (any status), or null. */
  async getMine(userId: string) {
    const session = await this.prisma.interviewSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    if (!session) return null;
    return { id: session.id, status: session.status };
  }

  /**
   * GET /interview-sessions/:id/result — candidate-scoped, own session
   * only (404 otherwise), and only once feedback has actually landed (404
   * before that, same "don't distinguish in-progress states" reasoning as
   * AssessmentSessionsService.getResult).
   */
  async getResult(userId: string, sessionId: string) {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { feedback: { include: { question: true } } },
    });
    if (!session || session.userId !== userId) throw new NotFoundException('Interview session not found');
    if (session.status !== InterviewSessionStatus.COMPLETED) {
      throw new NotFoundException('This session has not finished generating feedback yet.');
    }

    return {
      sessionId: session.id,
      completedAt: session.completedAt,
      answers: session.feedback.map((f: InterviewAnswerFeedback & { question: { text: string; category: InterviewQuestionCategory } | null }) => ({
        questionId: f.questionId,
        questionText: f.question?.text ?? null,
        category: f.question?.category ?? null,
        missingStarElement: f.missingStarElement,
        summary: f.summary,
        strengths: f.strengths as string[],
        improvements: f.improvements as string[],
      })),
      transcript: await this.publicTurns(sessionId),
    };
  }

  async retryFeedback(userId: string, sessionId: string) {
    await this.getOwnedSession(userId, sessionId);
    await this.feedback.retryFeedback(sessionId);
    return this.prisma.interviewSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  // ---------- helpers ----------

  /**
   * Resolves the job/employer to ground this session in — the candidate's
   * own most recent Application by default, or a specific one they name at
   * creation (applicationId), or (on every call after creation) whatever
   * the session already persisted (existingApplicationId). No application
   * at all is not an error: company-grounded touches are simply skipped
   * (see interview.constants.ts's candidateQuestionsInvite and
   * InterviewQuestionSelectorService), never faked with a generic
   * placeholder employer.
   */
  private async resolveGrounding(userId: string, applicationId?: string, existingApplicationId?: string | null): Promise<Grounding | null> {
    const candidateProfile = await this.prisma.candidateProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!candidateProfile) return null;

    const targetId = existingApplicationId ?? applicationId;

    const application = await this.prisma.application.findFirst({
      where: targetId ? { id: targetId, candidateProfileId: candidateProfile.id } : { candidateProfileId: candidateProfile.id },
      orderBy: targetId ? undefined : { createdAt: 'desc' },
      include: { job: { include: { organization: true } } },
    });
    if (!application) return null;

    return { applicationId: application.id, orgName: application.job.organization.name, jobTitle: application.job.title };
  }

  /** 404 (not 403) on a userId mismatch — same reasoning as
   * AssessmentSessionsService.getOwnedSession: confirming a session's
   * existence to a non-owner is itself a minor information leak. */
  private async getOwnedSession(userId: string, sessionId: string): Promise<InterviewSession> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) throw new NotFoundException('Interview session not found');
    return session;
  }

  private async publicTurns(sessionId: string): Promise<PublicTurn[]> {
    const turns = await this.prisma.interviewTurn.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } });
    return turns.map(toPublicTurn);
  }

  /** Server-side-only idle check, mirroring AssessmentSessionsService.enforceExpiry. */
  private async enforceExpiry(session: InterviewSession): Promise<InterviewSession> {
    if (session.status !== InterviewSessionStatus.IN_PROGRESS) return session;
    if (Date.now() < session.expiresAt.getTime()) return session;

    this.logger.log(`Interview session ${session.id} went idle past its expiry — marking EXPIRED`);
    return this.prisma.interviewSession.update({ where: { id: session.id }, data: { status: InterviewSessionStatus.EXPIRED } });
  }
}

export { computeProgress };
