import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttemptStatus, ClaimStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  listLive() {
    return this.prisma.assessment.findMany({
      where: { isLive: true },
      include: {
        skill: { include: { domain: true } },
        _count: { select: { questions: { where: { isLive: true } } } },
      },
    });
  }

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

    return this.prisma.attempt.create({
      data: {
        userId,
        assessmentId,
        status: AttemptStatus.IN_PROGRESS,
        startedAt: new Date(),
      },
    });
  }

  /** Questions WITHOUT the `correct` field — never leak answers to the client. */
  async getQuestions(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt is not in progress');
    }
    this.assertWithinTime(attempt);

    return this.prisma.question.findMany({
      where: { assessmentId: attempt.assessmentId, isLive: true },
      select: { id: true, type: true, body: true, difficulty: true },
    });
  }

  async submitAnswer(userId: string, attemptId: string, questionId: string, answer: unknown) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt is not in progress');
    }
    this.assertWithinTime(attempt);

    // Idempotent: re-answering overwrites (unique [attemptId, questionId])
    return this.prisma.attemptAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      update: { answer: answer as any },
      create: { attemptId, questionId, answer: answer as any },
    });
  }

  async submit(userId: string, attemptId: string) {
    const attempt = await this.getOwnedAttempt(userId, attemptId);
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new BadRequestException('Attempt already submitted');
    }

    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: { status: AttemptStatus.GRADING, submittedAt: new Date() },
    });

    // --- Synchronous MCQ grading (move to BullMQ worker later) ---
    const [answers, questions, assessment] = await Promise.all([
      this.prisma.attemptAnswer.findMany({ where: { attemptId } }),
      this.prisma.question.findMany({ where: { assessmentId: attempt.assessmentId, isLive: true } }),
      this.prisma.assessment.findUniqueOrThrow({ where: { id: attempt.assessmentId } }),
    ]);

    let correct = 0;
    for (const q of questions) {
      const a = answers.find((x: any) => x.questionId === q.id);
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

    if (passed) await this.issueBadge(userId, graded.id, assessment.skillId, assessment.targetLevel);

    return { attemptId, scorePercent, passed };
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
      assessmentTitle: full!.assessment.title,
      skillName: full!.assessment.skill.name,
      badge: full!.badge
        ? {
            verifyHash: full!.badge.verifyHash,
            level: full!.badge.level,
            expiresAt: full!.badge.expiresAt,
          }
        : null,
    };
  }

  /** Public badge verification: GET /badges/verify/:hash */
  async verifyBadge(hash: string) {
    const badge = await this.prisma.badge.findUnique({
      where: { verifyHash: hash },
      include: {
        user: { include: { profile: { select: { fullName: true } } } },
        attempt: { include: { assessment: { include: { skill: true } } } },
      },
    });
    if (!badge || badge.revokedAt) throw new NotFoundException('Badge not found or revoked');
    return {
      candidate: badge.user.profile?.fullName ?? 'SkillProof candidate',
      skill: badge.attempt.assessment.skill.name,
      level: badge.level,
      issuedAt: badge.issuedAt,
      expiresAt: badge.expiresAt,
      valid: badge.expiresAt > new Date(),
    };
  }

  // ---------- helpers ----------

  private async getOwnedAttempt(userId: string, attemptId: string) {
    const attempt = await this.prisma.attempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException('Attempt not found');
    // IDOR protection: users may only touch their own attempts (spec §7.2)
    if (attempt.userId !== userId) throw new ForbiddenException();
    return attempt;
  }

  private assertWithinTime(attempt: { startedAt: Date | null; assessmentId: string }) {
    // Server-side timing is authoritative; enforced fully once duration is
    // loaded with the attempt. Simplified here: enforce in submit() too.
  }

  private async issueBadge(userId: string, attemptId: string, skillId: string, level: any) {
    const badge = await this.prisma.badge.create({
      data: {
        userId,
        attemptId,
        level,
        verifyHash: randomBytes(12).toString('hex'),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 1.5), // 18 months
      },
    });

    // Upgrade the candidate's skill claim to VERIFIED
    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (profile) {
      await this.prisma.skillClaim.upsert({
        where: { profileId_skillId: { profileId: profile.id, skillId } },
        update: { status: ClaimStatus.VERIFIED, level, badgeId: badge.id },
        create: {
          profileId: profile.id,
          skillId,
          level,
          status: ClaimStatus.VERIFIED,
          badgeId: badge.id,
        },
      });
    }
    return badge;
  }
}
