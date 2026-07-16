import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AttemptStatus, BadgeVerificationMethod, IntegrityEventType, IntegrityStatus, Prisma, SkillLevel } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RecordIntegrityEventDto } from './assessments.dto';
import { BadgeResolverService, LEVEL_ORDER } from '../badges/badge-resolver.service';
import { AssessmentSessionsService } from '../assessment-sessions/assessment-sessions.service';
import { DISCUSSION_DURATION_MINS, SKILL_LEVEL as DISCUSSION_LEVEL, SKILL_NAME as DISCUSSION_SKILL_NAME } from '../assessment-sessions/rag-systems-l2.rubric';

/**
 * How many flag-worthy IntegrityEvents an attempt can accumulate before its
 * integrityStatus flips CLEAN → FLAGGED. "Flag-worthy" excludes purely
 * informational events (TAB_FOCUS just pairs with a prior TAB_BLUR for the
 * audit trail — regaining focus isn't itself a signal).
 */
const INTEGRITY_FLAG_THRESHOLD = Number(process.env.INTEGRITY_FLAG_THRESHOLD) || 5;
const NON_FLAGGING_EVENT_TYPES = new Set<IntegrityEventType>([IntegrityEventType.TAB_FOCUS]);

/**
 * Below this many milliseconds since the questions were served, an answer is
 * implausibly fast for a question that requires reading — recorded as a
 * RAPID_ANSWER signal. Deliberately conservative (a few seconds) since this
 * is a detect-and-record signal, not a hard block.
 */
const RAPID_ANSWER_THRESHOLD_MS = Number(process.env.RAPID_ANSWER_THRESHOLD_MS) || 3000;

type AttemptWithAssessment = Prisma.AttemptGetPayload<{ include: { assessment: true } }>;

/**
 * MCQ assessment flow (spec §4.4 state machine):
 * CREATED → IN_PROGRESS → SUBMITTED → GRADING → GRADED
 *
 * Grading is synchronous for MCQs in this first cut. When you add coding
 * (Judge0) and prompt tasks (LLM-judge), move grading to a BullMQ worker:
 * submit() should only flip status to GRADING and enqueue a job.
 */
@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly badgeResolver: BadgeResolverService,
    private readonly sessions: AssessmentSessionsService,
  ) {}

  /**
   * GET /assessments/catalog — the skill-grouped, level-rowed view backing
   * the candidate /assessments page. Groups every live MCQ Assessment by
   * skill+level, folds in the one hardcoded discussion format (RAG Systems
   * L2 — see rag-systems-l2.rubric.ts) as an additional format at its
   * skill+level, and resolves each level's earned state through
   * BadgeResolverService so precedence (discussion > test) is never
   * reimplemented here. The discussion format's own action/retake state is
   * exactly AssessmentSessionsService.getMine()'s existing per-user session
   * lookup — reused as-is, not duplicated, since there is only ever one
   * discussion flow in play for a given user regardless of which skill+level
   * row it's folded into.
   */
  async getCatalog(userId: string) {
    const assessments = await this.prisma.assessment.findMany({
      where: { isLive: true },
      include: { skill: { include: { domain: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const discussionSkill = await this.prisma.skill.findFirst({
      where: { name: DISCUSSION_SKILL_NAME },
      include: { domain: true },
    });
    const mine = discussionSkill ? await this.sessions.getMine(userId) : null;
    const discussionState = mine
      ? {
          sessionId: mine.id,
          status: mine.status,
          insufficientProbing: mine.insufficientProbing,
          retakeAvailableAt: mine.retakeAvailableAt,
        }
      : null;

    interface FormatEntry {
      type: 'TEST' | 'DISCUSSION';
      durationMins: number;
      assessmentId?: string;
      title?: string;
    }
    interface SkillBucket {
      skillId: string;
      skillName: string;
      domainName: string;
      description: string | null;
      levels: Map<SkillLevel, FormatEntry[]>;
    }

    const bySkill = new Map<string, SkillBucket>();
    function bucketFor(skillId: string, skillName: string, domainName: string, description: string | null): SkillBucket {
      let b = bySkill.get(skillId);
      if (!b) {
        b = { skillId, skillName, domainName, description, levels: new Map() };
        bySkill.set(skillId, b);
      }
      return b;
    }

    for (const a of assessments) {
      const b = bucketFor(a.skillId, a.skill.name, a.skill.domain.name, a.skill.description);
      const formats = b.levels.get(a.targetLevel) ?? [];
      formats.push({ type: 'TEST', durationMins: a.durationMins, assessmentId: a.id, title: a.title });
      b.levels.set(a.targetLevel, formats);
    }

    if (discussionSkill) {
      const b = bucketFor(discussionSkill.id, discussionSkill.name, discussionSkill.domain.name, discussionSkill.description);
      const formats = b.levels.get(DISCUSSION_LEVEL) ?? [];
      formats.push({ type: 'DISCUSSION', durationMins: DISCUSSION_DURATION_MINS });
      b.levels.set(DISCUSSION_LEVEL, formats);
    }

    const skills = [];
    for (const b of bySkill.values()) {
      const levelMap = await this.badgeResolver.resolveLevelMap(userId, b.skillId);
      const levels = LEVEL_ORDER.filter((level) => b.levels.has(level)).map((level) => {
        const formats = b.levels.get(level)!;
        const badge = levelMap[level];
        const hasDiscussion = formats.some((f) => f.type === 'DISCUSSION');
        return {
          level,
          formats,
          earned: badge
            ? { verifiedBy: badge.verifiedBy, verifyHash: badge.verifyHash, issuedAt: badge.issuedAt }
            : null,
          discussion: hasDiscussion ? discussionState : null,
        };
      });
      skills.push({
        skillId: b.skillId,
        skillName: b.skillName,
        domainName: b.domainName,
        description: b.description,
        levels,
      });
    }

    return skills;
  }

  listLive() {
    return this.prisma.assessment.findMany({
      where: { isLive: true },
      include: {
        skill: { include: { domain: true } },
        _count: { select: { questions: { where: { isLive: true } } } },
      },
    });
  }

  /**
   * Draws `assessment.questionsPerAttempt` random questions from the live
   * pool and persists the served set (QuestionServedAt) at creation time —
   * this is the one true "which questions belong to this attempt" record,
   * used for grading, for the per-question timing signal, and to reject
   * answers to questions this attempt was never shown.
   */
  async startAttempt(userId: string, assessmentId: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment || !assessment.isLive) throw new NotFoundException('Assessment not found');

    // One active attempt per assessment per user
    const active = await this.prisma.attempt.findFirst({
      where: {
        userId,
        assessmentId,
        status: { in: [AttemptStatus.CREATED, AttemptStatus.IN_PROGRESS] },
      },
    });
    if (active) return active;

    const pool = await this.prisma.question.findMany({
      where: { assessmentId, isLive: true },
      select: { id: true },
    });
    if (pool.length < assessment.questionsPerAttempt) {
      this.logger.warn(
        `Assessment ${assessmentId} has only ${pool.length} live question(s), fewer than ` +
          `questionsPerAttempt=${assessment.questionsPerAttempt}. Serving all of them.`,
      );
    }
    const served = this.sampleQuestions(pool, assessment.questionsPerAttempt);

    const attempt = await this.prisma.attempt.create({
      data: {
        userId,
        assessmentId,
        status: AttemptStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });

    if (served.length > 0) {
      await this.prisma.questionServedAt.createMany({
        data: served.map((q) => ({ attemptId: attempt.id, questionId: q.id })),
      });
    }

    return attempt;
  }

  /**
   * Questions WITHOUT the `correct` field — never leak answers to the
   * client. Returns the attempt's already-served set (drawn once, at
   * startAttempt) plus the server-computed remaining time so the UI can show
   * a countdown; the countdown display is a courtesy, not the enforcement —
   * see enforceDeadline.
   */
  async getQuestions(userId: string, attemptId: string) {
    let attempt = await this.getOwnedAttempt(userId, attemptId);
    attempt = await this.enforceDeadline(attempt);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('This attempt is no longer in progress.');
    }

    const served = await this.prisma.questionServedAt.findMany({
      where: { attemptId },
      orderBy: { servedAt: 'asc' },
      include: { question: { select: { id: true, type: true, body: true, difficulty: true } } },
    });

    const deadline = this.deadlineFor(attempt);
    return {
      questions: served.map((s) => s.question),
      remainingSeconds: deadline ? Math.max(0, Math.round((deadline.getTime() - Date.now()) / 1000)) : null,
      deadlineAt: deadline,
    };
  }

  async submitAnswer(userId: string, attemptId: string, questionId: string, answer: unknown) {
    let attempt = await this.getOwnedAttempt(userId, attemptId);
    attempt = await this.enforceDeadline(attempt);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'The time limit for this attempt has passed and it has been auto-submitted.',
      );
    }

    // Only accept answers for questions this attempt actually drew.
    const served = await this.prisma.questionServedAt.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
    if (!served) throw new BadRequestException('This question was not served in this attempt.');

    // Idempotent: re-answering overwrites (unique [attemptId, questionId])
    const result = await this.prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: { answer: answer as any },
      create: { attemptId, questionId, answer: answer as any },
    });

    await this.checkRapidAnswer(attempt, questionId);
    await this.refreshServedTimestamps(attemptId, questionId);

    return result;
  }

  /** Client-reported integrity signal — tab blur, paste, right-click, fullscreen exit, etc. */
  async recordIntegrityEvent(userId: string, attemptId: string, dto: RecordIntegrityEventDto) {
    await this.getOwnedAttempt(userId, attemptId);
    await this.addIntegrityEvent(attemptId, dto.type, dto.metadata);
    return { recorded: true };
  }

  async submit(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt already submitted');
    }

    await this.gradeAttempt(attemptId);
    const graded = await this.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    return { attemptId, scorePercent: graded.scorePercent, passed: graded.passed };
  }

  async getResult(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    const full = await this.prisma.attempt.findUnique({
      where: { id: attempt.id },
      include: {
        badge: true,
        assessment: { include: { skill: true } },
      },
    });
    return {
      id: full!.id,
      status: full!.status,
      scorePercent: full!.scorePercent,
      passed: full!.passed,
      passThreshold: full!.assessment.passThreshold,
      assessmentTitle: full!.assessment.title,
      skillName: full!.assessment.skill.name,
      badge: full!.badge
        ? {
            verifyHash: full!.badge.verifyHash,
            level: full!.badge.level,
            expiresAt: full!.badge.expiresAt,
          }
        : null,
      // Deliberately no integrity fields here — this is the candidate's own
      // result view. See AdminService.getAttemptForReview for the admin one.
      //
      // Deliberately no per-question or per-topic breakdown either: Question
      // has no topic/subskill tag today (schema.prisma), so a real
      // strong/weak-by-area summary isn't possible without first adding that
      // tagging — this stays an overall score until that lands. And even once
      // it does, this must only ever aggregate isCorrect by topic, never
      // return question text or `correct` — see gradeAttempt's own comment
      // on why `correct` never leaves the server.
    };
  }

  /**
   * Public badge verification: GET /badges/verify/:hash. Handles both
   * issuance paths — MCQ attempts and reviewed conversational sessions (see
   * ReviewService.issueBadge) — since Badge.attempt/Badge.session are each
   * optional and exactly one is ever set for a given badge. skill is read
   * directly off Badge.skill now (stored at mint time) rather than via the
   * attempt's assessment join, which only ever worked for the TEST path.
   */
  async verifyBadge(hash: string) {
    const badge = await this.prisma.badge.findUnique({
      where: { verifyHash: hash },
      include: {
        user: { include: { profile: { select: { fullName: true } } } },
        skill: true,
        attempt: true,
      },
    });
    if (!badge || badge.revokedAt) throw new NotFoundException('Badge not found or revoked');
    return {
      candidate: badge.user.profile?.fullName ?? 'SkillProof candidate',
      skill: badge.skill.name,
      level: badge.level,
      verifiedBy: badge.verifiedBy,
      issuedAt: badge.issuedAt,
      expiresAt: badge.expiresAt,
      valid: badge.expiresAt > new Date(),
      /**
       * A positive-only trust signal — true only when the attempt is
       * currently CLEAN (never flagged, or flagged and then admin-APPROVED,
       * which resets it to CLEAN — see AdminService.reviewAttempt). There is
       * deliberately no corresponding "flagged"/"under review" field: the
       * frontend can only ever render the positive mark or nothing. An
       * INVALIDATED attempt's badge is revoked (see reviewAttempt), so it
       * never reaches this far at all — the whole certificate 404s above.
       *
       * Session-issued badges have no equivalent integrity-monitoring
       * signal today (no proctoring on the conversational flow yet), and a
       * REJECTed session never reaches ISSUED in the first place — so any
       * session badge that exists is unconditionally "clean" until a future
       * revocation path is built for that flow.
       */
      verifiedClean: badge.attempt ? badge.attempt.integrityStatus === IntegrityStatus.CLEAN : true,
    };
  }

  // ---------- helpers ----------

  private async getOwnedAttempt(userId: string, attemptId: string): Promise<AttemptWithAssessment> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { assessment: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    // IDOR protection: users may only touch their own attempts (spec §7.2)
    if (attempt.userId !== userId) throw new ForbiddenException();
    return attempt;
  }

  private deadlineFor(attempt: { startedAt: Date | null; assessment: { durationMins: number } }): Date | null {
    if (!attempt.startedAt) return null;
    return new Date(attempt.startedAt.getTime() + attempt.assessment.durationMins * 60_000);
  }

  /**
   * Server-side-only deadline check — never trusts a client-side timer. If
   * the attempt is still IN_PROGRESS but startedAt + assessment.durationMins
   * has already passed, auto-submits/grades it right here with whatever
   * answers were recorded, exactly as if the candidate had clicked Submit.
   * Called at the top of every attempt-touching endpoint (getQuestions,
   * submitAnswer) so the deadline is enforced no matter which one the client
   * happens to call next — there's no separate timer/cron involved.
   */
  private async enforceDeadline(attempt: AttemptWithAssessment): Promise<AttemptWithAssessment> {
    if (attempt.status !== AttemptStatus.IN_PROGRESS) return attempt;
    const deadline = this.deadlineFor(attempt);
    if (!deadline || Date.now() < deadline.getTime()) return attempt;

    await this.gradeAttempt(attempt.id);
    return this.prisma.attempt.findUniqueOrThrow({
      where: { id: attempt.id },
      include: { assessment: true },
    });
  }

  /**
   * Shared grading logic — used by the explicit POST /attempts/:id/submit
   * endpoint AND by enforceDeadline's auto-submit-on-timeout path, so both
   * produce identical results from whatever answers happen to be recorded
   * at the moment grading runs. Grades against this attempt's *served* set
   * (QuestionServedAt), not the assessment's whole live pool — each attempt
   * only ever saw questionsPerAttempt of them.
   */
  private async gradeAttempt(attemptId: string): Promise<void> {
    const attempt = await this.prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
    if (attempt.status !== AttemptStatus.IN_PROGRESS) return;

    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { status: AttemptStatus.GRADING, submittedAt: new Date() },
    });

    const [answers, served, assessment] = await Promise.all([
      this.prisma.attemptAnswer.findMany({ where: { attemptId } }),
      this.prisma.questionServedAt.findMany({ where: { attemptId }, include: { question: true } }),
      this.prisma.assessment.findUniqueOrThrow({ where: { id: attempt.assessmentId } }),
    ]);
    const questions = served.map((s) => s.question);

    let correct = 0;
    for (const q of questions) {
      const a = answers.find((x) => x.questionId === q.id);
      const isCorrect =
        a != null && JSON.stringify(a.answer) === JSON.stringify((q.correct as any)?.answer);
      if (a) {
        await this.prisma.attemptAnswer.update({
          where: { id: a.id },
          data: { isCorrect },
        });
      }
      if (isCorrect) correct += 1;
    }

    const scorePercent = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    const passed = scorePercent >= assessment.passThreshold;

    const graded = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { status: AttemptStatus.GRADED, scorePercent, passed },
    });

    if (passed) {
      await this.issueBadge(attempt.userId, graded.id, assessment.skillId, assessment.targetLevel);
    }
  }

  /** Fisher-Yates partial shuffle — returns up to `count` items from `pool`, or all of it if smaller. */
  private sampleQuestions<T>(pool: T[], count: number): T[] {
    if (pool.length <= count) return pool;
    const arr = [...pool];
    for (let i = arr.length - 1; i > arr.length - 1 - count; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(arr.length - count);
  }

  /**
   * Per-question timing signal, computed entirely from server-recorded
   * timestamps — never anything the client reports. The reference point is
   * this question's own QuestionServedAt.servedAt (written by startAttempt's
   * random draw, then bumped forward by refreshServedTimestamps() every time
   * a *different* question gets answered — see that method for why). That
   * reset is what makes this a genuine per-question check: elapsed time is
   * no longer dominated by however long earlier questions took, the way it
   * would be if this were measured against a single fixed attempt-start time.
   * Falls back to attempt.startedAt only as a defensive safety net (a served
   * row should always exist once startAttempt() has run).
   */
  private async checkRapidAnswer(attempt: { id: string; startedAt: Date | null }, questionId: string): Promise<void> {
    const served = await this.prisma.questionServedAt.findUnique({
      where: { attemptId_questionId: { attemptId: attempt.id, questionId } },
    });
    const referenceTime = served?.servedAt ?? attempt.startedAt;
    if (!referenceTime) return;

    const elapsedMs = Date.now() - referenceTime.getTime();
    if (elapsedMs >= RAPID_ANSWER_THRESHOLD_MS) return;

    try {
      await this.addIntegrityEvent(attempt.id, IntegrityEventType.RAPID_ANSWER, {
        questionId,
        elapsedMs,
        referencePoint: served ? 'question_served' : 'attempt_started_fallback',
      });
    } catch {
      // Integrity bookkeeping must never fail the candidate's answer submission.
    }
  }

  /**
   * After an answer lands, every *other* not-yet-answered question is treated
   * as freshly served — the candidate's attention has now moved to what's
   * left. This is the piece that actually fixes "elapsed time dominated by
   * earlier questions": each remaining question's clock resets here instead
   * of accumulating from the original attempt start.
   *
   * Known trade-off (still a signal, not proof): if a candidate has already
   * been reading question 2 in parallel while answering question 1, this can
   * read as a rapid answer on 2 even though nothing untoward happened — that
   * false-positive risk is the cost of not knowing which question the
   * candidate is actually looking at in an all-at-once question set.
   */
  private async refreshServedTimestamps(attemptId: string, justAnsweredQuestionId: string): Promise<void> {
    const answered = await this.prisma.attemptAnswer.findMany({
      where: { attemptId },
      select: { questionId: true },
    });
    const answeredIds = new Set(answered.map((a) => a.questionId));
    answeredIds.add(justAnsweredQuestionId);

    await this.prisma.questionServedAt.updateMany({
      where: { attemptId, questionId: { notIn: [...answeredIds] } },
      data: { servedAt: new Date() },
    });
  }

  /**
   * Single choke point every integrity signal flows through — client-reported
   * (tab blur, paste, ...) or server-detected (RAPID_ANSWER) — so counting
   * and thresholding happen exactly once, consistently, server-side only.
   * Always writes the audit row; only "flag-worthy" types advance the counter
   * or can flip integrityStatus. The client never sets either directly.
   *
   * This only ever moves CLEAN → FLAGGED. An attempt is never auto-failed or
   * auto-blocked here — FLAGGED just means "needs admin review" (see
   * AdminService.listAttemptsForReview / reviewAttempt); grading, badge
   * issuance, and the certificate page all proceed normally regardless.
   */
  private async addIntegrityEvent(attemptId: string, type: IntegrityEventType, metadata?: unknown): Promise<void> {
    await this.prisma.integrityEvent.create({
      data: { attemptId, type, metadata: metadata as Prisma.InputJsonValue },
    });

    if (NON_FLAGGING_EVENT_TYPES.has(type)) return;

    const updated = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { integrityFlagCount: { increment: 1 } },
    });

    if (updated.integrityFlagCount > INTEGRITY_FLAG_THRESHOLD && updated.integrityStatus === IntegrityStatus.CLEAN) {
      await this.prisma.attempt.update({
        where: { id: attemptId },
        data: { integrityStatus: IntegrityStatus.FLAGGED },
      });
    }
  }

  private async issueBadge(userId: string, attemptId: string, skillId: string, level: any) {
    const badge = await this.prisma.badge.create({
      data: {
        userId,
        skillId,
        attemptId,
        level,
        verifiedBy: BadgeVerificationMethod.TEST,
        verifyHash: randomBytes(12).toString('hex'),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 1.5), // 18 months
      },
    });

    // Recompute SkillClaim from every non-revoked badge this user holds for
    // this skill — never a raw "point at whatever was just issued" upsert,
    // so a weaker/lower proof can never displace a stronger one already
    // held (see BadgeResolverService).
    await this.badgeResolver.syncSkillClaim(userId, skillId);
    return badge;
  }
}
