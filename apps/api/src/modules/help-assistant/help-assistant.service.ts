import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HelpAudience, OrgType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../llm/llm.service';
import { InMemoryRateLimiter } from '../../common/ip-rate-limiter';
import { AskHelpDto, HelpAudienceKey, HelpPlatform } from './help-assistant.dto';
import { HELP_GUIDES } from './help-guides.generated';
import { mentionsPaidPlans, withoutPaidPlanMentions } from './help-guide-parse';
import { guideHash, HelpLibraries, HelpLibraryMatcher, looksPersonal, normalizeQuestion } from './help-library';
import { HELP_LIBRARY } from './help-library.generated';

export const MAX_QUESTION_CHARS = 1000;
/** Generous for someone working through a problem; low enough to cap the AI bill per user. */
export const DAILY_QUESTION_LIMIT = 60;
export const RETENTION_DAYS = 90;

const GUIDE_PATHS: Record<HelpAudienceKey, string> = {
  candidate: '/help/candidate',
  employer: '/help/employer',
  recruiter: '/help/recruiter',
};

const AUDIENCE_ENUM: Record<HelpAudienceKey, HelpAudience> = {
  candidate: HelpAudience.CANDIDATE,
  employer: HelpAudience.EMPLOYER,
  recruiter: HelpAudience.RECRUITER,
};

export type HelpAnswerSource = 'library' | 'cache' | 'live';

export interface HelpAskResult {
  /** HelpQuestion id — pass as both sessionId and targetId to POST /ai-content-reports (targetType HELP_ANSWER). */
  id: string;
  answer: string;
  covered: boolean;
  /** Guide sections the answer came from; link each to `${guidePath}#${id}`. */
  sources: { id: string; label: string }[];
  guidePath: string;
  /** Where the answer came from — informational; clients render all three the same. */
  source: HelpAnswerSource;
}

/**
 * The in-app help assistant (signed-in users only). Answers come from the
 * guide for the user's own role — candidate, employer, or recruiter (an
 * employer user whose organisation is a staffing agency) — and from nothing
 * else, in three tiers, cheapest first:
 *  1. library — a close match in the pre-built, reviewed answer library
 *     (help-library.generated.ts), no AI call;
 *  2. cache — an earlier live answer to the same question while the guide is
 *     unchanged, no AI call;
 *  3. live — Claude, for everything else (follow-ups always go live, since
 *     they depend on the conversation).
 * Only live answers count toward the daily limit. The client sends the conversation so far;
 * nothing but the latest question and its answer is stored, as a
 * HelpQuestion row kept RETENTION_DAYS so it can be reported and so
 * uncovered questions show where the guides are thin.
 */
@Injectable()
export class HelpAssistantService {
  private readonly logger = new Logger(HelpAssistantService.name);
  /** Per user: at most one question every 2s and 20 per 10 minutes, on top of the daily cap. */
  private readonly burst = new InMemoryRateLimiter(2_000, 20, 10 * 60 * 1000);
  private readonly hashes = new Map<HelpAudienceKey, string>(
    (Object.keys(HELP_GUIDES) as HelpAudienceKey[]).map((a) => [a, guideHash(HELP_GUIDES[a].markdown)]),
  );
  private matchers = new Map<HelpAudienceKey, HelpLibraryMatcher>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {
    this.useLibraries(HELP_LIBRARY);
  }

  /** Builds a matcher per audience whose library was written from the current guide; others go live. */
  useLibraries(libraries: HelpLibraries): void {
    this.matchers = new Map();
    for (const audience of this.hashes.keys()) {
      const lib = libraries[audience];
      if (!lib?.entries.length) continue;
      if (lib.guideHash !== this.hashes.get(audience)) {
        this.logger.warn(`Help library for ${audience} is out of date with its guide; run npm run help:library. Answering live.`);
        continue;
      }
      this.matchers.set(audience, new HelpLibraryMatcher(lib.entries));
    }
  }

  async ask(userId: string, role: string, dto: AskHelpDto): Promise<HelpAskResult> {
    const history = dto.messages.map((m) => ({ role: m.role, content: m.content.trim() }));
    validateConversation(history);
    const question = history[history.length - 1].content;

    this.burst.hit(userId, "You're asking quickly — please wait a moment and try again.");

    const audience = await this.resolveAudience(userId, role, dto.audience);
    const platform: HelpPlatform = dto.platform ?? 'web';
    const noPaidPlans = platform === 'ios';
    const guide = HELP_GUIDES[audience];
    const hash = this.hashes.get(audience)!;
    const firstTurn = history.length === 1;
    const cacheKey = firstTurn && !looksPersonal(question) ? normalizeQuestion(question) || null : null;

    let result: { answer: string; covered: boolean; sectionIds: string[] } | null = null;
    let source: HelpAnswerSource = 'live';

    if (firstTurn) {
      const hit = this.matchers.get(audience)?.match(question);
      if (hit && !(noPaidPlans && mentionsPaidPlans(hit.entry.answer))) {
        result = { answer: hit.entry.answer, covered: true, sectionIds: hit.entry.sectionIds };
        source = 'library';
      }
    }

    if (!result && cacheKey) {
      const cached = await this.prisma.helpQuestion.findFirst({
        where: {
          audience: AUDIENCE_ENUM[audience],
          normalizedQuestion: cacheKey,
          guideHash: hash,
          source: 'live',
          platform: noPaidPlans ? 'ios' : { in: ['web', 'android'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { answer: true, covered: true, sectionIds: true },
      });
      if (cached) {
        result = cached;
        source = 'cache';
      }
    }

    if (!result) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const today = await this.prisma.helpQuestion.count({ where: { userId, source: 'live', createdAt: { gte: since } } });
      if (today >= DAILY_QUESTION_LIMIT) {
        throw new HttpException(
          "You've reached today's limit for help questions. Please try again tomorrow, or use the Contact page.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      try {
        result = await this.llm.answerHelpQuestion({
          audience,
          guide: noPaidPlans ? withoutPaidPlanMentions(guide.markdown) : guide.markdown,
          sectionIds: guide.sections.map((s) => s.id),
          history,
          noPaidPlans,
        });
      } catch (err) {
        // LlmService's errors carry the provider's raw message (status codes,
        // "invalid x-api-key"); that's for our logs, not for the person asking.
        this.logger.error(`Help assistant answer failed: ${(err as Error).message}`);
        throw new ServiceUnavailableException(
          "The help assistant isn't available right now. Please try again in a few minutes, or open the full guide.",
        );
      }
    }

    const saved = await this.prisma.helpQuestion.create({
      data: {
        userId,
        audience: AUDIENCE_ENUM[audience],
        platform,
        question,
        answer: result.answer,
        covered: result.covered,
        sectionIds: result.sectionIds,
        source,
        normalizedQuestion: cacheKey,
        guideHash: hash,
      },
      select: { id: true },
    });
    if (!result.covered) this.logger.log(`Help question not covered by the ${audience} guide: ${saved.id}`);

    const labels = new Map(guide.sections.map((s) => [s.id, s.label]));
    return {
      id: saved.id,
      answer: result.answer,
      covered: result.covered,
      sources: result.sectionIds.map((id) => ({ id, label: labels.get(id) ?? id })),
      guidePath: GUIDE_PATHS[audience],
      source,
    };
  }

  /** Candidates get the candidate guide; employer users the employer or recruiter guide by organisation type. */
  async resolveAudience(userId: string, role: string, requested?: HelpAudienceKey): Promise<HelpAudienceKey> {
    if (role === Role.CANDIDATE) return 'candidate';
    if (role === Role.PLATFORM_ADMIN) return requested ?? 'employer';
    const membership = await this.prisma.orgMember.findUnique({
      where: { userId },
      select: { organization: { select: { type: true } } },
    });
    return membership?.organization.type === OrgType.STAFFING ? 'recruiter' : 'employer';
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeOld(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const { count } = await this.prisma.helpQuestion.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (count > 0) this.logger.log(`Deleted ${count} help question(s) older than ${RETENTION_DAYS} days.`);
    } catch (err) {
      this.logger.error(`Help question retention sweep failed: ${(err as Error).message}`);
    }
  }
}

/** Starts with the user, alternates, ends with a non-empty question within the length cap. */
export function validateConversation(history: { role: string; content: string }[]): void {
  history.forEach((turn, i) => {
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (turn.role !== expected) throw new BadRequestException('Messages must alternate, starting with a question.');
    if (!turn.content) throw new BadRequestException('Messages cannot be empty.');
  });
  const last = history[history.length - 1];
  if (last.role !== 'user') throw new BadRequestException('The last message must be your question.');
  if (last.content.length > MAX_QUESTION_CHARS) {
    throw new BadRequestException(`Please keep your question under ${MAX_QUESTION_CHARS} characters.`);
  }
}
