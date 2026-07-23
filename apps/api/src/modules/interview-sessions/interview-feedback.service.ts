import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { InterviewSessionStatus, InterviewTurnRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Bigger, slower, more expensive model — appropriate here even though live
 * turns use the cheap one (see LlmService's claude-haiku-4-5), because this
 * runs exactly once per session, after it ends, not once per turn. Same
 * tier AssessmentSessionsModule's own scoring/live-feedback services use. */
const MODEL = 'claude-sonnet-4-6';
const REQUEST_TIMEOUT_MS = 60_000;

export type StarElement = 'situation' | 'task' | 'action' | 'result';
const STAR_ELEMENTS: StarElement[] = ['situation', 'task', 'action', 'result'];

interface QuestionExchange {
  questionId: string;
  questionText: string;
  whatToLookFor: string;
  expectedElements: { situation: string; task: string; action: string; result: string };
  transcript: string;
  /** The candidate's first (base) answer turn for this question — feedback
   * links here; a follow-up answer, if any, is folded into `transcript`
   * but doesn't get its own feedback row. */
  candidateTurnId: string;
}

interface AnswerFeedbackResult {
  questionId: string;
  missingStarElement: StarElement | null;
  summary: string;
  strengths: string[];
  improvements: string[];
}

const RECORD_SESSION_FEEDBACK_TOOL: Anthropic.Tool = {
  name: 'record_session_feedback',
  description: 'Record structured coaching feedback for every question the candidate answered in this mock interview session.',
  input_schema: {
    type: 'object',
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question_id: { type: 'string', description: 'The questionId this feedback is for, copied exactly from the input.' },
            missing_star_element: {
              anyOf: [{ type: 'string', enum: STAR_ELEMENTS }, { type: 'null' }],
              description:
                'The single weakest or entirely absent STAR component in the CANDIDATE\'S OWN answer — ' +
                '"situation", "task", "action", or "result" — or null if their answer had complete STAR ' +
                'structure. Judge structure and reasoning in what they actually said, never whether it ' +
                'resembles the reference example.',
            },
            summary: { type: 'string', description: 'A 1-2 sentence overall assessment of this answer.' },
            strengths: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 3,
              description: '1-3 short, specific things the candidate did well, grounded in what they actually said.',
            },
            improvements: {
              type: 'array',
              items: { type: 'string' },
              minItems: 0,
              maxItems: 2,
              description: '0-2 short, specific, actionable suggestions — empty if the answer was already strong.',
            },
          },
          required: ['question_id', 'missing_star_element', 'summary', 'strengths', 'improvements'],
          additionalProperties: false,
        },
      },
    },
    required: ['answers'],
    additionalProperties: false,
  },
};

/**
 * CRITICAL, per this feature's own spec: expectedElements is an
 * illustrative reference point written by the product owner — one
 * plausible strong answer's shape — never a checklist. Score whether the
 * candidate's OWN answer has complete STAR structure (a real situation, a
 * clear task, concrete actions, a stated result) and sound reasoning
 * throughout. Do not check whether their answer mentions the specific
 * tactics, nouns, or scenario in the reference example — a candidate whose
 * situation was completely different from the example, but whose answer is
 * equally complete and well-reasoned, must score identically to one whose
 * situation happens to match the example. Penalizing a candidate for not
 * echoing the reference example's specific content would be a scoring bug,
 * not a stricter standard.
 */
const SYSTEM_PROMPT = `You are an experienced interview coach writing feedback on a candidate's mock behavioral interview, after the session has already ended. You will be given, for each question the candidate answered: the question text, what trait it was meant to probe for, an illustrative STAR-shaped reference example of what a strong answer tends to contain, and the actual exchange (question, candidate's answer, and any follow-up).

CRITICAL — read this carefully: the reference example is illustrative only, describing what a strong answer TENDS to contain — it is NOT a checklist to match against. Score whether the candidate's OWN answer has complete STAR structure (a real situation, a clear task, concrete actions taken, and a stated result) and sound reasoning throughout. Never check whether their answer mentions the specific tactics, nouns, or scenario from the reference example. A candidate whose situation was completely different from the example, but whose answer is equally complete and well-reasoned, must score identically to one whose situation happens to resemble the example. Treating the reference example as a checklist would silently and unfairly penalize honest, well-structured answers that simply describe a different real situation.

For each question, identify the single weakest or entirely absent STAR component in the candidate's own answer (situation, task, action, or result) — or null if their answer had complete STAR structure throughout. This is the most specific, actionable piece of feedback you can give, so get it right: it should name a real structural gap, not a stylistic nitpick.

Be honest and specific rather than just encouraging — name genuine strengths and genuine gaps, grounded only in what the candidate actually said. Never invent details they didn't mention. This is coaching for a practice session, not a pass/fail verdict, so keep the tone warm and constructive even when a gap exists.

Call record_session_feedback once with one entry per question provided, in any order, each carrying question_id copied exactly from the input so it can be matched back up.`;

/**
 * The batched, once-per-session feedback pass — never generated per-answer
 * during the live conversation (that would leak how the candidate is doing
 * mid-interview, which this feature explicitly avoids). Owns its whole
 * pipeline (assemble transcript -> call the model -> persist ->
 * update session status), the same shape as AssessmentSessionsModule's
 * ScoringService, not the smaller per-turn LiveFeedbackService — this is a
 * once-per-session batch, not a best-effort per-turn helper.
 */
@Injectable()
export class InterviewFeedbackService {
  private readonly logger = new Logger(InterviewFeedbackService.name);
  private readonly client: Anthropic;

  constructor(private readonly prisma: PrismaService) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * On success: session -> COMPLETED, completedAt set, feedbackError
   * cleared. On any failure, the session is left exactly as it was
   * (AWAITING_FEEDBACK) with feedbackError populated, and the error is
   * rethrown so a caller awaiting this (retryFeedback) sees it — the
   * fire-and-forget trigger site only logs it.
   */
  async generateFeedbackForSession(sessionId: string): Promise<void> {
    try {
      const exchanges = await this.assembleExchanges(sessionId);

      const results = exchanges.length > 0 ? await this.callModel(exchanges) : [];
      const byQuestionId = new Map(results.map((r) => [r.questionId, r]));

      // Re-check right before writing — guards against a race with a
      // concurrent retry that already finished.
      const fresh = await this.prisma.interviewSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (fresh.status !== InterviewSessionStatus.AWAITING_FEEDBACK) {
        this.logger.warn(`Session ${sessionId} is no longer AWAITING_FEEDBACK (now ${fresh.status}) — discarding this duplicate feedback pass.`);
        return;
      }

      await this.prisma.$transaction([
        ...exchanges.map((e) => {
          const result = byQuestionId.get(e.questionId);
          return this.prisma.interviewAnswerFeedback.create({
            data: {
              sessionId,
              candidateTurnId: e.candidateTurnId,
              questionId: e.questionId,
              missingStarElement: result?.missingStarElement ?? null,
              summary: result?.summary ?? 'Feedback for this answer could not be generated.',
              strengths: (result?.strengths ?? []) as unknown as Prisma.InputJsonValue,
              improvements: (result?.improvements ?? []) as unknown as Prisma.InputJsonValue,
            },
          });
        }),
        this.prisma.interviewSession.update({
          where: { id: sessionId },
          data: { status: InterviewSessionStatus.COMPLETED, completedAt: new Date(), feedbackError: null },
        }),
      ]);

      this.logger.log(`Session ${sessionId} feedback generated for ${exchanges.length} question(s) — now COMPLETED.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Feedback generation failed for session ${sessionId}: ${message}`);
      await this.prisma.interviewSession
        .update({ where: { id: sessionId }, data: { feedbackError: message } })
        .catch((updateErr: Error) => this.logger.error(`Failed to persist feedbackError for session ${sessionId}: ${updateErr.message}`));
      throw err;
    }
  }

  /** Candidate-facing retry for a session stuck in AWAITING_FEEDBACK — 409 otherwise. */
  async retryFeedback(sessionId: string): Promise<void> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Interview session not found');
    if (session.status !== InterviewSessionStatus.AWAITING_FEEDBACK) {
      throw new ConflictException('Session is not awaiting feedback.');
    }
    await this.generateFeedbackForSession(sessionId);
  }

  /** Groups every non-superseded turn by questionId (in first-seen order)
   * into one QuestionExchange each — OPENING/CANDIDATE_QUESTIONS/CLOSING
   * turns (questionId null) are never scored. */
  private async assembleExchanges(sessionId: string): Promise<QuestionExchange[]> {
    const turns = await this.prisma.interviewTurn.findMany({
      where: { sessionId, superseded: false, questionId: { not: null } },
      orderBy: { createdAt: 'asc' },
      include: { question: true },
    });

    const order: string[] = [];
    const byQuestion = new Map<string, typeof turns>();
    for (const turn of turns) {
      const qid = turn.questionId!;
      if (!byQuestion.has(qid)) {
        order.push(qid);
        byQuestion.set(qid, []);
      }
      byQuestion.get(qid)!.push(turn);
    }

    const exchanges: QuestionExchange[] = [];
    for (const qid of order) {
      const group = byQuestion.get(qid)!;
      const question = group[0].question;
      if (!question) continue; // defensive — questionId is a valid FK, this should never be null
      const baseCandidateTurn = group.find((t) => t.role === InterviewTurnRole.CANDIDATE);
      if (!baseCandidateTurn) continue; // the coach asked but the session ended before an answer landed

      const transcript = group.map((t) => `${t.role}: ${t.content}`).join('\n\n');
      exchanges.push({
        questionId: qid,
        questionText: question.text,
        whatToLookFor: question.whatToLookFor,
        expectedElements: question.expectedElements as unknown as QuestionExchange['expectedElements'],
        transcript,
        candidateTurnId: baseCandidateTurn.id,
      });
    }
    return exchanges;
  }

  private async callModel(exchanges: QuestionExchange[]): Promise<AnswerFeedbackResult[]> {
    const input = exchanges
      .map(
        (e, i) =>
          `--- Question ${i + 1} (question_id: ${e.questionId}) ---\n` +
          `What this question probes for: ${e.whatToLookFor}\n` +
          `Illustrative reference (NOT a checklist — see system instructions): ` +
          `situation: ${e.expectedElements.situation} | task: ${e.expectedElements.task} | ` +
          `action: ${e.expectedElements.action} | result: ${e.expectedElements.result}\n\n` +
          `Exchange:\n${e.transcript}`,
      )
      .join('\n\n');

    return this.callForTool(
      {
        system: [{ type: 'text', text: SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: `${input}\n\nWrite feedback for every question now.` }],
        maxTokens: 4000,
      },
      (raw) => this.validateShape(raw, exchanges.map((e) => e.questionId)),
    );
  }

  private async callForTool(
    params: { system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[]; maxTokens: number },
    validate: (input: unknown) => AnswerFeedbackResult[],
  ): Promise<AnswerFeedbackResult[]> {
    const attempt = async (retryReminder?: string): Promise<AnswerFeedbackResult[]> => {
      const system = retryReminder ? [...params.system, { type: 'text' as const, text: retryReminder }] : params.system;
      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create(
          {
            model: MODEL,
            max_tokens: params.maxTokens,
            system,
            messages: params.messages,
            tools: [RECORD_SESSION_FEEDBACK_TOOL],
            tool_choice: { type: 'tool', name: RECORD_SESSION_FEEDBACK_TOOL.name },
          },
          { timeout: REQUEST_TIMEOUT_MS },
        );
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          this.logger.error(`Anthropic API error during session feedback (status ${err.status}): ${err.message}`);
          throw new BadGatewayException(`Anthropic API error during session feedback: ${err.message}`);
        }
        this.logger.error(`Anthropic request failed during session feedback: ${(err as Error).message}`);
        throw new BadGatewayException(`Failed to reach the AI coach: ${(err as Error).message}`);
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === RECORD_SESSION_FEEDBACK_TOOL.name,
      );
      if (!toolUse) throw new Error('No record_session_feedback tool call in the response.');
      return validate(toolUse.input);
    };

    try {
      return await attempt();
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      this.logger.warn(`Malformed session feedback output; retrying once (${(err as Error).message})`);
      try {
        return await attempt(
          'Your previous record_session_feedback call did not match the required shape, was missing an entry, ' +
            'or included an unknown question_id. Call it again, with exactly one entry per question provided, ' +
            'each question_id copied exactly from the input.',
        );
      } catch (retryErr) {
        if (retryErr instanceof BadGatewayException) throw retryErr;
        this.logger.error(`Malformed session feedback output again after retry: ${(retryErr as Error).message}`);
        throw new BadGatewayException('The AI coach returned malformed feedback after one retry.');
      }
    }
  }

  private validateShape(input: unknown, expectedQuestionIds: string[]): AnswerFeedbackResult[] {
    if (typeof input !== 'object' || input === null) throw new Error('feedback input is not an object');
    const answers = (input as Record<string, unknown>).answers;
    if (!Array.isArray(answers)) throw new Error('feedback output is missing "answers"');

    const validIds = new Set(expectedQuestionIds);
    const seen = new Set<string>();
    const results: AnswerFeedbackResult[] = [];

    for (const item of answers) {
      if (typeof item !== 'object' || item === null) throw new Error('malformed answer entry');
      const d = item as Record<string, unknown>;
      if (
        typeof d.question_id !== 'string' ||
        !validIds.has(d.question_id) ||
        (d.missing_star_element !== null && !STAR_ELEMENTS.includes(d.missing_star_element as StarElement)) ||
        typeof d.summary !== 'string' ||
        !Array.isArray(d.strengths) ||
        !d.strengths.every((s) => typeof s === 'string') ||
        !Array.isArray(d.improvements) ||
        !d.improvements.every((s) => typeof s === 'string')
      ) {
        throw new Error(`malformed or unrecognized answer entry: ${JSON.stringify(item).slice(0, 200)}`);
      }
      seen.add(d.question_id);
      results.push({
        questionId: d.question_id,
        missingStarElement: d.missing_star_element as StarElement | null,
        summary: d.summary,
        strengths: d.strengths as string[],
        improvements: d.improvements as string[],
      });
    }

    const missing = expectedQuestionIds.filter((id) => !seen.has(id));
    if (missing.length > 0) throw new Error(`feedback output is missing entries for question ids: ${missing.join(', ')}`);

    return results;
  }
}
