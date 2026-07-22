import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ClaimStatus, IntegrityStatus, Prisma, ReviewOutcome, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import {
  BulkQuestionItemDto,
  CreateAssessmentDto,
  CreateQuestionDto,
  ListAttemptsQueryDto,
  ReviewAttemptDto,
  SetSubscriptionDto,
  UpdateAssessmentDto,
} from './admin.dto';

interface BulkItemErrors {
  index: number;
  errors: string[];
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Manual tier assignment — foundation work for testing entitlements
   * before any payment provider exists (see EntitlementsService's own
   * module doc comment). `candidateProfileId` is CandidateProfile.id, the
   * same id every other employer/admin-facing surface keys candidates by.
   */
  setSubscription(candidateProfileId: string, dto: SetSubscriptionDto) {
    return this.entitlements.setTierManually(
      candidateProfileId,
      dto.tier,
      dto.status ?? SubscriptionStatus.ACTIVE,
      dto.currentPeriodEnd ? new Date(dto.currentPeriodEnd) : null,
      dto.cancelAtPeriodEnd ?? false,
    );
  }

  listAssessments() {
    return this.prisma.assessment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        skill: { include: { domain: true } },
        _count: { select: { questions: { where: { isLive: true } } } },
      },
    });
  }

  createAssessment(dto: CreateAssessmentDto) {
    return this.prisma.assessment.create({ data: dto });
  }

  async updateAssessment(id: string, dto: UpdateAssessmentDto) {
    await this.getAssessmentOrThrow(id);
    return this.prisma.assessment.update({ where: { id }, data: dto });
  }

  async addQuestion(assessmentId: string, dto: CreateQuestionDto) {
    await this.getAssessmentOrThrow(assessmentId);
    if (dto.correctIndex >= dto.options.length) {
      throw new BadRequestException('correctIndex must reference one of the provided options');
    }

    return this.prisma.question.create({
      data: this.buildQuestionData(assessmentId, dto.text, dto.options, dto.correctIndex, dto.difficulty),
    });
  }

  /**
   * Validates the entire batch before writing anything — a bad item anywhere
   * in the paste fails the whole import with a per-item report instead of
   * half-importing. Rows are created via the exact same data shape as
   * `addQuestion` (buildQuestionData), so bulk and single-question imports
   * are indistinguishable in the DB.
   */
  async bulkAddQuestions(assessmentId: string, body: unknown) {
    await this.getAssessmentOrThrow(assessmentId);

    if (!Array.isArray(body) || body.length === 0) {
      throw new BadRequestException('Expected a non-empty JSON array of question objects.');
    }

    const errorReport: BulkItemErrors[] = [];
    const valid: BulkQuestionItemDto[] = [];

    for (let index = 0; index < body.length; index++) {
      const raw = body[index];
      if (typeof raw !== 'object' || raw === null) {
        errorReport.push({ index, errors: ['Expected a JSON object'] });
        continue;
      }

      const dto = plainToInstance(BulkQuestionItemDto, raw);
      const violations = await validate(dto);
      const messages = violations.flatMap((v) => Object.values(v.constraints ?? {}));

      if (Array.isArray(dto.options) && Number.isInteger(dto.correctIndex) && dto.correctIndex >= dto.options.length) {
        messages.push('correctIndex must reference one of the provided options');
      }

      if (messages.length > 0) {
        errorReport.push({ index, errors: messages });
      } else {
        valid.push(dto);
      }
    }

    if (errorReport.length > 0) {
      throw new BadRequestException({
        message: `${errorReport.length} of ${body.length} question(s) failed validation — nothing was imported.`,
        errors: errorReport,
      });
    }

    const created = await this.prisma.$transaction(
      valid.map((dto) =>
        this.prisma.question.create({
          data: this.buildQuestionData(assessmentId, dto.question, dto.options, dto.correctIndex, dto.difficulty ?? 2),
        }),
      ),
    );

    return { created: created.length };
  }

  /** Single source of truth for the Question row shape — reused by addQuestion and bulkAddQuestions. */
  private buildQuestionData(
    assessmentId: string,
    text: string,
    options: string[],
    correctIndex: number,
    difficulty: number,
  ): Prisma.QuestionCreateInput {
    return {
      assessment: { connect: { id: assessmentId } },
      type: 'MCQ',
      body: { text, options },
      correct: { answer: correctIndex },
      difficulty,
      isLive: true,
    };
  }

  async removeQuestion(id: string) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) throw new NotFoundException('Question not found');
    return this.prisma.question.update({ where: { id }, data: { isLive: false } });
  }

  /**
   * Admin-only attempt detail, including integrity signals — the candidate's
   * own GET /attempts/:id/result never includes any of this. Events are
   * summarized by type/count plus the full timeline; flags/events, not a
   * verdict — admins interpret them, the system doesn't auto-fail attempts.
   */
  async getAttemptForReview(id: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, phone: true, email: true, profile: { select: { fullName: true } } } },
        assessment: { select: { title: true, skill: { select: { name: true } } } },
        integrityEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    const eventCountsByType: Record<string, number> = {};
    for (const e of attempt.integrityEvents) {
      eventCountsByType[e.type] = (eventCountsByType[e.type] ?? 0) + 1;
    }

    return {
      id: attempt.id,
      status: attempt.status,
      scorePercent: attempt.scorePercent,
      passed: attempt.passed,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      candidate: {
        id: attempt.user.id,
        fullName: attempt.user.profile?.fullName ?? null,
        phone: attempt.user.phone,
        email: attempt.user.email,
      },
      assessmentTitle: attempt.assessment.title,
      skillName: attempt.assessment.skill.name,
      integrity: {
        status: attempt.integrityStatus,
        flagCount: attempt.integrityFlagCount,
        eventCountsByType,
        events: attempt.integrityEvents.map((e) => ({
          type: e.type,
          metadata: e.metadata,
          createdAt: e.createdAt,
        })),
      },
    };
  }

  /** Lightweight list for the review queue — GET /admin/attempts?status=FLAGGED. */
  async listAttemptsForReview(query: ListAttemptsQueryDto) {
    const attempts = await this.prisma.attempt.findMany({
      where: query.status ? { integrityStatus: query.status } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { id: true, phone: true, email: true, profile: { select: { fullName: true } } } },
        assessment: { select: { title: true, skill: { select: { name: true } } } },
      },
    });

    return attempts.map((a) => ({
      id: a.id,
      status: a.status,
      scorePercent: a.scorePercent,
      passed: a.passed,
      candidate: {
        id: a.user.id,
        fullName: a.user.profile?.fullName ?? null,
        phone: a.user.phone,
        email: a.user.email,
      },
      assessmentTitle: a.assessment.title,
      skillName: a.assessment.skill.name,
      integrityStatus: a.integrityStatus,
      integrityFlagCount: a.integrityFlagCount,
      reviewOutcome: a.reviewOutcome,
      reviewedAt: a.reviewedAt,
    }));
  }

  /**
   * The only path that can invalidate an attempt/badge — never automatic.
   * APPROVED clears the flag back to CLEAN (the candidate is never
   * permanently penalized in the UI for something an admin reviewed and
   * cleared — the certificate's "Verified clean" mark reappears). INVALIDATED
   * revokes the badge (so the public certificate 404s outright) and expires
   * the resulting skill claim, so an invalidated result stops conferring
   * "verified" anywhere else in the app (search, matching, etc.).
   */
  async reviewAttempt(attemptId: string, adminUserId: string, dto: ReviewAttemptDto) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { badge: true },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    const newStatus = dto.outcome === ReviewOutcome.APPROVED ? IntegrityStatus.CLEAN : IntegrityStatus.INVALIDATED;

    const updated = await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        integrityStatus: newStatus,
        reviewOutcome: dto.outcome,
        reviewNote: dto.note,
        reviewedAt: new Date(),
        reviewedByUserId: adminUserId,
        ...(dto.outcome === ReviewOutcome.INVALIDATED ? { passed: false } : {}),
      },
    });

    if (dto.outcome === ReviewOutcome.INVALIDATED && attempt.badge) {
      await this.prisma.badge.update({
        where: { id: attempt.badge.id },
        data: { revokedAt: new Date() },
      });
      await this.prisma.skillClaim.updateMany({
        where: { badgeId: attempt.badge.id },
        data: { status: ClaimStatus.EXPIRED },
      });
    }

    return updated;
  }

  private async getAssessmentOrThrow(id: string) {
    const assessment = await this.prisma.assessment.findUnique({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }
}
