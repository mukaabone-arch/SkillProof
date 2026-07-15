import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AssessmentSessionStatus, Prisma, RagL2Claim, SessionTurn, Verdict } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CLAIM_BANDS, CLAIM_HINTS, CLAIM_ORDER, SKILL_LEVEL, SKILL_NAME } from './rag-systems-l2.rubric';

const MODEL = 'claude-sonnet-4-6';
const REQUEST_TIMEOUT_MS = 30_000;

export interface Span {
  quote: string;
  probeContext: string;
}

interface AdjudicationResult {
  verdict: Verdict;
  confidence: number;
  reason: string;
  bandBoundary: boolean;
}

const VALID_VERDICTS: Verdict[] = [Verdict.DEMONSTRATED, Verdict.PARTIAL, Verdict.NOT_EVIDENCED, Verdict.ABSTAIN];

const COMPETENCY_LIST = CLAIM_ORDER.map((c) => CLAIM_HINTS[c].label).join(', ');

/**
 * Pass 1 (extraction) system prompt — one call per session, given the whole
 * transcript. Kept deliberately separate from pass 2: extraction never sees
 * bands/verdicts, adjudication never sees the full transcript or other
 * claims' spans. That isolation is what lets pass 2 judge each claim on its
 * own evidence, without cross-claim halo effects.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are extracting evidence for a technical assessment review. You will be given a transcript of a system-design interview. Each line is labeled with which competency area the assessor was probing at that point and which stage of the probe it was (OPENING, FOLLOWUP, or CONSTRAINT) — for example "[ASSESSOR | CHUNKING/OPENING]".

Your job: for each of the six competency areas below, extract every verbatim quote from the CANDIDATE's own turns that bears on that area — evidence for it, evidence against it, or evidence that undermines something said elsewhere in the conversation. A quote must be copied character-for-character from a candidate turn. Never paraphrase, summarize, clean up, or invent a quote.

Competency areas: ${COMPETENCY_LIST}.

Critical instructions:
- Extract undermining evidence exactly as carefully as supporting evidence. If the candidate says something in one part of the conversation that contradicts or weakens something they said elsewhere, capture that too — it matters just as much as confirming evidence.
- An empty list for a competency area is a completely correct answer if nothing in the transcript actually bears on it. Do not manufacture or stretch evidence to fill a gap. When in doubt, leave it out.
- Evidence for a competency area can appear anywhere in the transcript, not only under that area's own labeled probes. Candidates often volunteer something early that turns out to be relevant to a later topic, or revise something after a later question changes the picture. Read the whole transcript for every competency area — do not just copy the candidate turns that happen to be labeled with that area's probes.
- Each quote must be genuinely verbatim. If you're tempted to lightly edit a quote to make it read better or fix a typo, don't — extract the exact original text instead, fragment or not.
- probe_context should name the labeled probe (e.g. "RERANKING/CONSTRAINT") the quote is from or nearest to in the transcript, regardless of which competency area you file the quote under.

Call record_spans with your findings — one array per competency area, using empty arrays where nothing applies.`;

/**
 * Pass 2 (adjudication) system prompt — one call per claim. The per-claim
 * clauses/triggers/spans are appended as a second system block by
 * adjudicateClaim, never in this shared text, so this prompt stays
 * identical across all six calls.
 */
export const ADJUDICATION_SYSTEM_PROMPT = `You are adjudicating exactly one competency area from a technical system-design interview, based only on the evidence spans already extracted for it. You are not shown the rest of the interview and must not infer anything about other competency areas — judge this one area on its own, from its own evidence only.

This competency is defined by exactly two clauses (given to you below, specific to this competency). Apply this rule mechanically:
- Both clauses are clearly satisfied -> DEMONSTRATED
- Exactly one clause is clearly satisfied -> PARTIAL
- Neither clause is satisfied -> NOT_EVIDENCED

Use ABSTAIN only when there is no usable evidence at all for this competency — the evidence list is empty, or every span is clearly about something else. Never guess a verdict when there's nothing to judge; abstaining is the correct answer in that case, not a failure to reach one.

Judge content, not tone:
- Hedging language ("I think", "maybe", "I'm not totally sure, but...") is not itself an absence of content. Evaluate what the candidate actually proposed after the hedge, on its own merits.
- Fluent, confident-sounding language that doesn't actually commit to a concrete mechanism is not content. A smooth restatement of the question, or a plausible-sounding assertion with nothing underneath it, does not satisfy a clause just because it reads well.
- A confidently-stated answer that fails both clauses is still NOT_EVIDENCED. Confidence is not evidence — some of the most fluent-sounding answers turn out to be the emptiest, and some of the most halting ones hold up completely once you look at what was actually proposed.

Set band_boundary to true when the answer sits right at the edge between two verdict levels — for example, it solidly satisfies one clause and gestures at the second without quite committing to it, or it's a genuinely close call between PARTIAL and NOT_EVIDENCED. This flags the case for priority human review, so set it honestly whenever you were genuinely torn, not only in extreme cases.

Set confidence to your own confidence in this verdict, from 0 to 1. This is recorded for calibration research only — it has no effect on anything downstream, so don't let it influence the verdict itself.

Write reason as 2-4 sentences a human reviewer can read to understand your call without re-reading the transcript — cite what was said, or notably not said, in plain language.

You will be given this competency's two clauses, any competency-specific patterns worth watching for, and the extracted evidence. Call record_verdict with your adjudication.`;

const SPAN_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    quote: { type: 'string', description: 'Verbatim, character-for-character quote from a CANDIDATE turn.' },
    probe_context: { type: 'string', description: 'The labeled probe this quote is from or nearest to, e.g. "RERANKING/CONSTRAINT".' },
  },
  required: ['quote', 'probe_context'],
  additionalProperties: false,
};

function buildClaimsSchemaProperties(): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const claim of CLAIM_ORDER) props[claim] = { type: 'array', items: SPAN_ITEM_SCHEMA };
  return props;
}

const RECORD_SPANS_TOOL: Anthropic.Tool = {
  name: 'record_spans',
  description: 'Record verbatim evidence spans extracted from the candidate transcript, organized per competency area.',
  input_schema: {
    type: 'object',
    properties: { claims: { type: 'object', properties: buildClaimsSchemaProperties(), required: [...CLAIM_ORDER], additionalProperties: false } },
    required: ['claims'],
    additionalProperties: false,
  },
};

const RECORD_VERDICT_TOOL: Anthropic.Tool = {
  name: 'record_verdict',
  description: 'Record the adjudicated verdict for this single competency area.',
  input_schema: {
    type: 'object',
    properties: {
      claim_id: { type: 'string', enum: [...CLAIM_ORDER] },
      verdict: { type: 'string', enum: VALID_VERDICTS },
      confidence: { type: 'number', description: '0-1 self-reported confidence. Recorded for calibration only — never used downstream.' },
      reason: { type: 'string' },
      band_boundary: { type: 'boolean' },
    },
    required: ['claim_id', 'verdict', 'confidence', 'reason', 'band_boundary'],
    additionalProperties: false,
  },
};

/**
 * Two-pass AI scoring: pass 1 extracts verbatim evidence spans per claim
 * from the full transcript in one call; pass 2 adjudicates each claim in
 * total isolation (its own bands, its own spans only) against the r2 bands
 * in rag-systems-l2.rubric.ts. Both passes use forced tool_choice — free
 * text JSON was tried in the harness this mirrors and the model
 * second-guessed itself mid-response, so every call here forces a single
 * tool and reads the result from the tool_use block, never from prose.
 *
 * Nothing this service does ever auto-issues anything: a successful score
 * only ever lands a session on AWAITING_REVIEW, never further.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private readonly client: Anthropic;

  constructor(private readonly prisma: PrismaService) {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /**
   * On success: session -> AWAITING_REVIEW, scoredAt set, scoringError
   * cleared. On any failure, the session is left exactly as it was
   * (AWAITING_SCORING) with scoringError populated, and the error is
   * rethrown so a caller awaiting this (retryScoring) sees it — the
   * fire-and-forget trigger site only logs it.
   */
  async scoreSession(sessionId: string): Promise<void> {
    try {
      const session = await this.prisma.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });

      // Superseded turns are fragments re-asked after a resume — never
      // scoring input. Reflection turns have claimId null and aren't
      // scored against any claim.
      const turns = await this.prisma.sessionTurn.findMany({
        where: { sessionId, superseded: false, claimId: { not: null } },
        orderBy: { createdAt: 'asc' },
      });

      const spansByClaim = await this.extractSpans(turns);

      const adjudications = await Promise.all(
        CLAIM_ORDER.map(async (claim) => ({ claim, result: await this.adjudicateClaim(claim, spansByClaim[claim]) })),
      );

      // Re-check right before writing — guards against a race with a
      // concurrent retry that already finished scoring this same session.
      const fresh = await this.prisma.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (fresh.status !== AssessmentSessionStatus.AWAITING_SCORING) {
        this.logger.warn(
          `Session ${sessionId} is no longer AWAITING_SCORING (now ${fresh.status}) — discarding this duplicate scoring pass.`,
        );
        return;
      }

      await this.prisma.$transaction([
        ...adjudications.map(({ claim, result }) =>
          this.prisma.claimVerdict.create({
            data: {
              sessionId,
              claimId: claim,
              rubricVersion: session.rubricVersion,
              verdict: result.verdict,
              bandBoundary: result.bandBoundary,
              reason: result.reason,
              modelVerdict: result.verdict,
              modelBandBoundary: result.bandBoundary,
              modelReason: result.reason,
              modelConfidence: result.confidence,
              spans: spansByClaim[claim] as unknown as Prisma.InputJsonValue,
            },
          }),
        ),
        this.prisma.assessmentSession.update({
          where: { id: sessionId },
          data: { status: AssessmentSessionStatus.AWAITING_REVIEW, scoredAt: new Date(), scoringError: null },
        }),
      ]);

      this.logger.log(`Session ${sessionId} scored successfully across ${CLAIM_ORDER.length} claims — now AWAITING_REVIEW.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scoring failed for session ${sessionId}: ${message}`);
      await this.prisma.assessmentSession
        .update({ where: { id: sessionId }, data: { scoringError: message } })
        .catch((updateErr: Error) =>
          this.logger.error(`Failed to persist scoringError for session ${sessionId}: ${updateErr.message}`),
        );
      throw err;
    }
  }

  /** POST /assessment-sessions/:id/score — 409 unless the session is actually stuck in AWAITING_SCORING. */
  async retryScoring(sessionId: string): Promise<import('@prisma/client').AssessmentSession> {
    const session = await this.prisma.assessmentSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Assessment session not found');
    if (session.status !== AssessmentSessionStatus.AWAITING_SCORING) {
      throw new ConflictException('Session is not awaiting scoring.');
    }
    await this.scoreSession(sessionId);
    return this.prisma.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  /**
   * GET /assessment-sessions/review-queue — lightweight enough to render
   * the queue without loading any transcript. No candidate name: candidateId
   * only, so the review UI works off case IDs.
   */
  async getReviewQueue() {
    const sessions = await this.prisma.assessmentSession.findMany({
      where: { status: AssessmentSessionStatus.AWAITING_REVIEW },
      include: { claimVerdicts: true, _count: { select: { interruptions: true } } },
    });

    const rows = sessions.map((s) => {
      const counts = { demonstrated: 0, partial: 0, notEvidenced: 0, abstain: 0, boundary: 0 };
      for (const v of s.claimVerdicts) {
        if (v.verdict === Verdict.DEMONSTRATED) counts.demonstrated++;
        else if (v.verdict === Verdict.PARTIAL) counts.partial++;
        else if (v.verdict === Verdict.NOT_EVIDENCED) counts.notEvidenced++;
        else if (v.verdict === Verdict.ABSTAIN) counts.abstain++;
        if (v.bandBoundary) counts.boundary++;
      }
      return {
        sessionId: s.id,
        candidateId: s.userId,
        skill: SKILL_NAME,
        level: SKILL_LEVEL,
        completedAt: s.scoredAt,
        counts,
        interruptionCount: s._count.interruptions,
        needsPriorityReview: counts.abstain > 0 || counts.boundary > 0,
      };
    });

    rows.sort((a, b) => {
      if (a.needsPriorityReview !== b.needsPriorityReview) return a.needsPriorityReview ? -1 : 1;
      return (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0);
    });

    return rows;
  }

  // ---------- pass 1: extraction ----------

  private async extractSpans(turns: SessionTurn[]): Promise<Record<RagL2Claim, Span[]>> {
    const transcript = this.buildTranscript(turns);
    const candidateTexts = turns.filter((t) => t.role === 'CANDIDATE').map((t) => t.content);

    const raw = await this.callForTool(
      {
        system: [{ type: 'text', text: EXTRACTION_SYSTEM_PROMPT }],
        messages: [{ role: 'user', content: transcript }],
        maxTokens: 4000,
      },
      RECORD_SPANS_TOOL,
      (input) => this.validateExtractionShape(input),
      'span extraction',
    );

    // Defense in depth: a hallucinated "verbatim" quote is worse than a
    // missing one — drop anything that isn't an exact substring of some
    // candidate turn rather than trusting the model's claim.
    const filtered = {} as Record<RagL2Claim, Span[]>;
    for (const claim of CLAIM_ORDER) {
      filtered[claim] = raw[claim].filter((span) => {
        if (span.quote.trim().length === 0) return false;
        const isVerbatim = candidateTexts.some((text) => text.includes(span.quote));
        if (!isVerbatim) {
          this.logger.warn(`Dropping non-verbatim ${claim} span: "${span.quote.slice(0, 80)}"`);
        }
        return isVerbatim;
      });
    }
    return filtered;
  }

  private buildTranscript(turns: SessionTurn[]): string {
    return turns.map((t) => `[${t.role} | ${t.claimId}/${t.probeRung}]: ${t.content}`).join('\n\n');
  }

  // ---------- pass 2: adjudication ----------

  private async adjudicateClaim(claim: RagL2Claim, spans: Span[]): Promise<AdjudicationResult> {
    const bands = CLAIM_BANDS[claim];
    const spansText =
      spans.length === 0
        ? 'No evidence was extracted for this competency area.'
        : spans.map((s, i) => `${i + 1}. "${s.quote}" (near ${s.probeContext})`).join('\n');

    const claimContext =
      `Competency: ${CLAIM_HINTS[claim].label}\n\n` +
      `Clause A: ${bands.clauseA}\n` +
      `Clause B: ${bands.clauseB}\n\n` +
      'Known NOT_EVIDENCED patterns for this competency specifically (in addition to the general rule above):\n' +
      bands.notEvidencedTriggers.map((t) => `- ${t}`).join('\n') +
      `\n\nExtracted evidence for this competency:\n${spansText}`;

    return this.callForTool(
      {
        system: [
          { type: 'text', text: ADJUDICATION_SYSTEM_PROMPT },
          { type: 'text', text: claimContext },
        ],
        messages: [{ role: 'user', content: 'Adjudicate this competency now.' }],
        maxTokens: 800,
      },
      RECORD_VERDICT_TOOL,
      (input) => this.validateAdjudicationShape(input, claim),
      `adjudication for ${claim}`,
    );
  }

  // ---------- shared call plumbing ----------

  /**
   * Forced tool_choice call with the retry contract from the task: an API
   * error (network, 4xx/5xx) fails immediately — the SDK's own max_retries
   * already covers transient ones, a second manual attempt wouldn't help.
   * A malformed/missing tool call is retried once with a pointed reminder,
   * then fails for good.
   */
  private async callForTool<T>(
    params: { system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[]; maxTokens: number },
    tool: Anthropic.Tool,
    validate: (input: unknown) => T,
    label: string,
  ): Promise<T> {
    const attempt = async (retryReminder?: string): Promise<T> => {
      const system = retryReminder ? [...params.system, { type: 'text' as const, text: retryReminder }] : params.system;
      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create(
          {
            model: MODEL,
            max_tokens: params.maxTokens,
            system,
            messages: params.messages,
            tools: [tool],
            tool_choice: { type: 'tool', name: tool.name },
          },
          { timeout: REQUEST_TIMEOUT_MS },
        );
      } catch (err) {
        if (err instanceof Anthropic.APIError) {
          this.logger.error(`Anthropic API error during ${label} (status ${err.status}): ${err.message}`);
          throw new BadGatewayException(`Anthropic API error during ${label}: ${err.message}`);
        }
        this.logger.error(`Anthropic request failed during ${label}: ${(err as Error).message}`);
        throw new BadGatewayException(`Failed to reach the AI scorer during ${label}: ${(err as Error).message}`);
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use' && block.name === tool.name,
      );
      if (!toolUse) {
        throw new Error(`No ${tool.name} tool call in the response for ${label}.`);
      }
      return validate(toolUse.input);
    };

    try {
      return await attempt();
    } catch (err) {
      if (err instanceof BadGatewayException) throw err;
      this.logger.warn(`Malformed tool output for ${label}; retrying once (${(err as Error).message})`);
      try {
        return await attempt(
          `Your previous ${tool.name} call did not match the required shape or was missing. Call ${tool.name} again, filling every required field correctly this time.`,
        );
      } catch (retryErr) {
        if (retryErr instanceof BadGatewayException) throw retryErr;
        this.logger.error(`Malformed tool output for ${label} again after retry: ${(retryErr as Error).message}`);
        throw new BadGatewayException(`The AI scorer returned malformed output for ${label} after one retry.`);
      }
    }
  }

  private validateExtractionShape(input: unknown): Record<RagL2Claim, Span[]> {
    if (typeof input !== 'object' || input === null) throw new Error('extraction input is not an object');
    const claims = (input as Record<string, unknown>).claims;
    if (typeof claims !== 'object' || claims === null) throw new Error('extraction output is missing "claims"');

    const result = {} as Record<RagL2Claim, Span[]>;
    for (const claim of CLAIM_ORDER) {
      const arr = (claims as Record<string, unknown>)[claim];
      if (!Array.isArray(arr)) throw new Error(`extraction output is missing the array for claim ${claim}`);
      result[claim] = arr.map((item, idx) => {
        if (
          typeof item !== 'object' ||
          item === null ||
          typeof (item as Record<string, unknown>).quote !== 'string' ||
          typeof (item as Record<string, unknown>).probe_context !== 'string'
        ) {
          throw new Error(`malformed span at ${claim}[${idx}]`);
        }
        const span = item as { quote: string; probe_context: string };
        return { quote: span.quote, probeContext: span.probe_context };
      });
    }
    return result;
  }

  private validateAdjudicationShape(input: unknown, expectedClaim: RagL2Claim): AdjudicationResult {
    if (typeof input !== 'object' || input === null) throw new Error('adjudication input is not an object');
    const d = input as Record<string, unknown>;
    if (
      d.claim_id !== expectedClaim ||
      typeof d.verdict !== 'string' ||
      !VALID_VERDICTS.includes(d.verdict as Verdict) ||
      typeof d.confidence !== 'number' ||
      typeof d.reason !== 'string' ||
      typeof d.band_boundary !== 'boolean'
    ) {
      throw new Error('malformed record_verdict output');
    }
    return { verdict: d.verdict as Verdict, confidence: d.confidence, reason: d.reason, bandBoundary: d.band_boundary };
  }
}
