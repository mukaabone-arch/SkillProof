import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { RagL2Claim, SessionTurn } from '@prisma/client';
import { CLAIM_BANDS, CLAIM_HINTS, SKILL_LEVEL } from './rag-systems-l2.rubric';

const MODEL = 'claude-sonnet-4-6';
const REQUEST_TIMEOUT_MS = 30_000;

export type VerdictTone = 'positive' | 'mixed' | 'needs_work';
const VALID_TONES: VerdictTone[] = ['positive', 'mixed', 'needs_work'];

export interface LiveFeedbackResult {
  verdictLabel: string;
  verdictTone: VerdictTone;
  summary: string;
  strengths: string[];
  gaps: string[];
}

const RECORD_LIVE_FEEDBACK_TOOL: Anthropic.Tool = {
  name: 'record_live_feedback',
  description: 'Record informal, candidate-facing coaching feedback for the topic the candidate just finished discussing.',
  input_schema: {
    type: 'object',
    properties: {
      verdict_label: {
        type: 'string',
        description: `A short informal label relative to the ${SKILL_LEVEL} bar for this topic, e.g. "Meets ${SKILL_LEVEL}", "Approaching ${SKILL_LEVEL}", "Needs more depth". Plain language, never the words "score" or "grade".`,
      },
      verdict_tone: {
        type: 'string',
        enum: VALID_TONES,
        description:
          '"positive" if the answer solidly meets the bar, "mixed" if it partially meets it with a real gap, "needs_work" if it falls notably short. Drives the chip color the candidate sees — must agree with verdict_label and gaps, never contradict them (e.g. never "positive" alongside a verdict_label that says "needs more depth").',
      },
      summary: {
        type: 'string',
        description: 'A short qualifier phrase continuing the verdict label, e.g. "strong on retrieval". A few words, not a sentence.',
      },
      strengths: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
        description: '1-3 short, specific sentences on what the candidate did well, grounded in what they actually said.',
      },
      gaps: {
        type: 'array',
        items: { type: 'string' },
        minItems: 0,
        maxItems: 2,
        description: '0-2 short, specific sentences on what to focus on next. Empty if the answer was fully solid.',
      },
    },
    required: ['verdict_label', 'verdict_tone', 'summary', 'strengths', 'gaps'],
    additionalProperties: false,
  },
};

/**
 * Deliberately distinct from ScoringService.ADJUDICATION_SYSTEM_PROMPT: this
 * feedback is shown live to the candidate as informal coaching, never the
 * official scored result (that stays hidden until a human reviewer decides
 * the session — see ReviewService). Honest but warm; grounded in the actual
 * exchange, never invented.
 */
const SYSTEM_PROMPT = `You are writing brief, warm, specific coaching feedback shown directly to a candidate right after they finish discussing one topic in a live, conversational technical interview. This is informal, in-the-moment encouragement — never the official scored result (that stays hidden and is decided separately by a human reviewer later). Be honest and specific rather than just encouraging: name what was genuinely strong and, if there's a real gap relative to the level bar, name that too, plainly and kindly. Ground every point in what the candidate actually said — never invent specifics. Keep each bullet to one short sentence.

verdict_tone renders as a colored chip in the UI, so it must never contradict verdict_label, summary, or gaps — if you list a real gap, tone cannot be "positive"; if verdict_label says the bar was met cleanly, tone cannot be "needs_work". Pick the one tone that a reader would agree with after reading the rest of what you wrote.`;

/**
 * Generates one informal coaching note per completed claim (topic), shown
 * live to the candidate — see AssessmentSessionsService.postTurn, which
 * calls this once a claim's ladder walk finishes. Entirely separate from
 * ScoringService's two-pass adjudication: different prompt, different
 * model call, different persisted table (LiveClaimFeedback, never
 * ClaimVerdict), and best-effort rather than authoritative — a failure
 * here must never block turn submission.
 */
@Injectable()
export class LiveFeedbackService {
  private readonly logger = new Logger(LiveFeedbackService.name);
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * Best-effort: never throws. A failure here (API error, or malformed
   * output after one retry) yields null — "no live note this time," not an
   * error the caller has to handle.
   */
  async generateClaimFeedback(claimId: RagL2Claim, claimTurns: SessionTurn[]): Promise<LiveFeedbackResult | null> {
    try {
      const bands = CLAIM_BANDS[claimId];
      const label = CLAIM_HINTS[claimId].label;
      const transcript = claimTurns.map((t) => `${t.role}: ${t.content}`).join('\n\n');

      const claimContext =
        `Topic: ${label}\n\n` +
        `What a strong answer covers:\n- ${bands.clauseA}\n- ${bands.clauseB}\n\n` +
        `Here is the exchange on this topic:\n${transcript}`;

      return await this.callForTool(
        {
          system: [
            { type: 'text', text: SYSTEM_PROMPT },
            { type: 'text', text: claimContext },
          ],
          messages: [{ role: 'user', content: 'Write the live feedback now.' }],
          maxTokens: 500,
        },
        (input) => this.validateShape(input),
      );
    } catch (err) {
      this.logger.warn(`Live feedback generation failed for claim ${claimId}: ${(err as Error).message}`);
      return null;
    }
  }

  private async callForTool<T>(
    params: { system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[]; maxTokens: number },
    validate: (input: unknown) => T,
  ): Promise<T> {
    const attempt = async (retryReminder?: string): Promise<T> => {
      const system = retryReminder ? [...params.system, { type: 'text' as const, text: retryReminder }] : params.system;
      const response = await this.client.messages.create(
        {
          model: MODEL,
          max_tokens: params.maxTokens,
          system,
          messages: params.messages,
          tools: [RECORD_LIVE_FEEDBACK_TOOL],
          tool_choice: { type: 'tool', name: RECORD_LIVE_FEEDBACK_TOOL.name },
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === RECORD_LIVE_FEEDBACK_TOOL.name,
      );
      if (!toolUse) throw new Error('No record_live_feedback tool call in the response.');
      return validate(toolUse.input);
    };

    try {
      return await attempt();
    } catch (err) {
      this.logger.warn(`Malformed live feedback output; retrying once (${(err as Error).message})`);
      return attempt(
        'Your previous record_live_feedback call did not match the required shape or was missing. Call it again, filling every required field correctly this time.',
      );
    }
  }

  private validateShape(input: unknown): LiveFeedbackResult {
    if (typeof input !== 'object' || input === null) throw new Error('live feedback input is not an object');
    const d = input as Record<string, unknown>;
    if (
      typeof d.verdict_label !== 'string' ||
      typeof d.verdict_tone !== 'string' ||
      !VALID_TONES.includes(d.verdict_tone as VerdictTone) ||
      typeof d.summary !== 'string' ||
      !Array.isArray(d.strengths) ||
      !d.strengths.every((s) => typeof s === 'string') ||
      !Array.isArray(d.gaps) ||
      !d.gaps.every((g) => typeof g === 'string')
    ) {
      throw new Error('malformed record_live_feedback output');
    }
    return {
      verdictLabel: d.verdict_label,
      verdictTone: d.verdict_tone as VerdictTone,
      summary: d.summary,
      strengths: d.strengths as string[],
      gaps: d.gaps as string[],
    };
  }
}
