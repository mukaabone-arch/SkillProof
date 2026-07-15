import { BadGatewayException, BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  AssessmentSessionStatus,
  Badge,
  ClaimStatus,
  ClaimVerdict,
  RagL2Claim,
  SkillLevel,
  Verdict,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Span } from './scoring.service';
import { CLAIM_ORDER, SKILL_LEVEL, SKILL_NAME } from './rag-systems-l2.rubric';

/**
 * Distance on the quality scale, used only for the "two-band-disagreement
 * needs a note" rule (see reviewClaim). ABSTAIN and INSUFFICIENT_PROBING
 * both sit at 0 — they're "no real judgment possible" states, qualitatively
 * different in *why* but not meaningfully different in *distance* from each
 * other for this purpose. Not used anywhere in the AI scoring pipeline
 * itself (that's ScoringService's VALID_VERDICTS, a separate four-value
 * universe the model is restricted to).
 */
const BAND_ORDER: Record<Verdict, number> = {
  [Verdict.DEMONSTRATED]: 3,
  [Verdict.PARTIAL]: 2,
  [Verdict.NOT_EVIDENCED]: 1,
  [Verdict.ABSTAIN]: 0,
  [Verdict.INSUFFICIENT_PROBING]: 0,
};

/**
 * The level rule only gates on the first five claims in CLAIM_ORDER
 * (chunking, diagnosis, reranking, corpus_change, evaluation) — COST
 * (claim 6) is tracked and shown to the reviewer like any other claim, but
 * doesn't factor into ISSUE eligibility. This is a specific, easy-to-miss
 * rule from the spec ("claims 1-5"), not an oversight.
 */
const LEVEL_RULE_CLAIMS: RagL2Claim[] = CLAIM_ORDER.slice(0, 5);
const MIN_DEMONSTRATED_FOR_ISSUE = 3;

interface LevelEligibility {
  eligible: boolean;
  blockedByInsufficientProbing: boolean;
  demonstratedCount: number;
  gatingClaimCount: number;
  reason: string | null;
}

function computeLevelEligibility(claimVerdicts: ClaimVerdict[]): LevelEligibility {
  const byClaim = new Map(claimVerdicts.map((v) => [v.claimId, v]));
  const gating = LEVEL_RULE_CLAIMS.map((c) => byClaim.get(c)).filter((v): v is ClaimVerdict => !!v);

  const hasInsufficientProbing = gating.some((v) => v.reviewerVerdict === Verdict.INSUFFICIENT_PROBING);
  if (hasInsufficientProbing) {
    return {
      eligible: false,
      blockedByInsufficientProbing: true,
      demonstratedCount: 0,
      gatingClaimCount: gating.length,
      reason:
        'One or more gating claims were marked INSUFFICIENT_PROBING — the assessor failed to elicit evidence there. Offer the candidate a re-take rather than rejecting them.',
    };
  }

  const demonstratedCount = gating.filter((v) => v.reviewerVerdict === Verdict.DEMONSTRATED).length;
  const allPartialOrBetter = gating.every(
    (v) => v.reviewerVerdict === Verdict.DEMONSTRATED || v.reviewerVerdict === Verdict.PARTIAL,
  );

  if (!allPartialOrBetter) {
    return {
      eligible: false,
      blockedByInsufficientProbing: false,
      demonstratedCount,
      gatingClaimCount: gating.length,
      reason: 'Not every gating claim (chunking, diagnosis, reranking, corpus change, evaluation) is PARTIAL or better.',
    };
  }
  if (demonstratedCount < MIN_DEMONSTRATED_FOR_ISSUE) {
    return {
      eligible: false,
      blockedByInsufficientProbing: false,
      demonstratedCount,
      gatingClaimCount: gating.length,
      reason: `Only ${demonstratedCount} of the ${gating.length} gating claims are DEMONSTRATED — at least ${MIN_DEMONSTRATED_FOR_ISSUE} are required.`,
    };
  }
  return {
    eligible: true,
    blockedByInsufficientProbing: false,
    demonstratedCount,
    gatingClaimCount: gating.length,
    reason: null,
  };
}

/**
 * Human review of AI-scored sessions — the only surface that mints a badge
 * for a conversational assessment. Enforces anti-anchoring server-side
 * (getReviewCase never sends modelVerdict/modelReason for an unreviewed
 * claim, full stop — there's no client-side toggle to defeat), write-once
 * reviews (reviewClaim 409s on a second attempt), and the level rule as the
 * sole gate on ISSUE (decide).
 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /assessment-sessions/:id/review — the reviewer's case payload. No candidate name anywhere: session/candidate id only. */
  async getReviewCase(sessionId: string) {
    const session = await this.prisma.assessmentSession.findUnique({
      where: { id: sessionId },
      include: {
        claimVerdicts: true,
        interruptions: { orderBy: { occurredAt: 'asc' } },
        turns: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) throw new NotFoundException('Assessment session not found');
    if (session.claimVerdicts.length === 0) {
      throw new BadRequestException('This session has not been scored yet.');
    }

    const claims = CLAIM_ORDER.map((claimId) => {
      const v = session.claimVerdicts.find((c) => c.claimId === claimId);
      if (!v) throw new BadGatewayException(`Missing ClaimVerdict for ${claimId} — scoring may be incomplete.`);

      const base = {
        claimId: v.claimId,
        spans: v.spans as unknown as Span[],
        bandBoundary: v.bandBoundary,
        reviewed: v.reviewerVerdict !== null,
        reviewerVerdict: v.reviewerVerdict,
        reviewerNote: v.reviewerNote,
        reviewedAt: v.reviewedAt,
      };

      // Anti-anchoring, enforced here — not by hiding it in the UI. An
      // unreviewed claim's object simply never has these keys.
      if (v.reviewerVerdict === null) return base;
      return {
        ...base,
        modelVerdict: v.modelVerdict,
        modelReason: v.modelReason,
        agree: v.reviewerVerdict === v.modelVerdict,
      };
    });

    const reviewedCount = session.claimVerdicts.filter((v) => v.reviewerVerdict !== null).length;
    const decisionPreview = reviewedCount === CLAIM_ORDER.length ? computeLevelEligibility(session.claimVerdicts) : null;

    return {
      sessionId: session.id,
      candidateId: session.userId,
      status: session.status,
      skill: SKILL_NAME,
      level: SKILL_LEVEL,
      durationMinutes: session.scoredAt
        ? Math.round((session.scoredAt.getTime() - session.startedAt.getTime()) / 60_000)
        : null,
      completedAt: session.scoredAt,
      decidedAt: session.decidedAt,
      decisionNote: session.decisionNote,
      reviewedCount,
      totalClaims: CLAIM_ORDER.length,
      decisionPreview,
      interruptions: session.interruptions.map((i) => ({
        occurredAt: i.occurredAt,
        resumedAt: i.resumedAt,
        fragmentTurnId: i.fragmentTurnId,
      })),
      claims,
      transcript: session.turns.map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
        claimId: t.claimId,
        probeRung: t.probeRung,
        superseded: t.superseded,
        isReflection: t.claimId === null,
        createdAt: t.createdAt,
      })),
    };
  }

  /**
   * POST /assessment-sessions/:id/claims/:claimId/review — write-once. The
   * model's verdict/reason are only ever returned from *this* call's
   * response, after the reviewer's own verdict is already committed to the
   * DB — never before, and never via getReviewCase for a still-unreviewed
   * claim.
   */
  async reviewClaim(sessionId: string, claimId: string, adminUserId: string, verdict: Verdict, note: string | undefined) {
    if (!CLAIM_ORDER.includes(claimId as RagL2Claim)) {
      throw new BadRequestException(`Unknown claim "${claimId}".`);
    }

    const existing = await this.prisma.claimVerdict.findUnique({
      where: { sessionId_claimId: { sessionId, claimId: claimId as RagL2Claim } },
    });
    if (!existing) throw new NotFoundException('This claim has not been scored for this session yet.');
    if (existing.reviewerVerdict !== null) {
      throw new ConflictException(
        'This claim has already been reviewed. Reviews are write-once — a mistaken review is corrected by a second reviewer later, not by overwriting.',
      );
    }

    const distance = Math.abs(BAND_ORDER[verdict] - BAND_ORDER[existing.modelVerdict]);
    if (distance >= 2 && !note?.trim()) {
      throw new BadRequestException(
        "Your verdict differs from the model's by two or more bands — add a note explaining your reasoning before submitting.",
      );
    }

    const updated = await this.prisma.claimVerdict.update({
      where: { id: existing.id },
      data: { reviewerVerdict: verdict, reviewerId: adminUserId, reviewerNote: note ?? null, reviewedAt: new Date() },
    });

    return {
      claimId: updated.claimId,
      reviewerVerdict: updated.reviewerVerdict,
      reviewerNote: updated.reviewerNote,
      reviewedAt: updated.reviewedAt,
      // Revealed only now.
      modelVerdict: updated.modelVerdict,
      modelReason: updated.modelReason,
      modelBandBoundary: updated.modelBandBoundary,
      agree: updated.reviewerVerdict === updated.modelVerdict,
    };
  }

  /**
   * POST /assessment-sessions/:id/decision — 409 unless every claim has a
   * reviewerVerdict. REJECT never issues a badge. ISSUE applies the level
   * rule to the *reviewer* verdicts (never the model's) and, if eligible,
   * mints a badge through the exact same Badge/SkillClaim mechanism the MCQ
   * assessments flow uses (see issueBadge below vs.
   * AssessmentsService.issueBadge) — no parallel badge system.
   */
  async decide(sessionId: string, adminUserId: string, decision: 'ISSUE' | 'REJECT', note: string | undefined) {
    const session = await this.prisma.assessmentSession.findUnique({
      where: { id: sessionId },
      include: { claimVerdicts: true },
    });
    if (!session) throw new NotFoundException('Assessment session not found');
    if (session.status !== AssessmentSessionStatus.AWAITING_REVIEW) {
      throw new ConflictException('This session is not awaiting a decision.');
    }
    if (session.claimVerdicts.length !== CLAIM_ORDER.length || session.claimVerdicts.some((v) => v.reviewerVerdict === null)) {
      throw new ConflictException('Every claim must be reviewed before a decision can be made.');
    }

    if (decision === 'REJECT') {
      const updated = await this.prisma.assessmentSession.update({
        where: { id: sessionId },
        data: {
          status: AssessmentSessionStatus.REJECTED,
          decidedByUserId: adminUserId,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        },
      });
      return { session: updated, badge: null, eligibility: null };
    }

    const eligibility = computeLevelEligibility(session.claimVerdicts);
    if (!eligibility.eligible) {
      throw new ConflictException(eligibility.reason ?? 'This session is not eligible for ISSUE.');
    }

    const skill = await this.prisma.skill.findFirst({ where: { name: SKILL_NAME } });
    if (!skill) {
      throw new BadGatewayException(`Skill "${SKILL_NAME}" is not seeded in the taxonomy — cannot issue a badge.`);
    }

    const updated = await this.prisma.assessmentSession.update({
      where: { id: sessionId },
      data: {
        status: AssessmentSessionStatus.ISSUED,
        decidedByUserId: adminUserId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });

    const badge = await this.issueBadge(session.userId, sessionId, skill.id, SKILL_LEVEL);

    return { session: updated, badge, eligibility };
  }

  /**
   * Mirrors AssessmentsService.issueBadge (MCQ path) field-for-field — same
   * verifyHash generation, same 18-month expiry policy, same SkillClaim
   * upsert into VERIFIED — just keyed by sessionId instead of attemptId
   * (see Badge's widened schema). This is the reuse: same tables, same
   * verification semantics, same public /badges/verify/:hash flow — not a
   * parallel credential system.
   */
  private async issueBadge(userId: string, sessionId: string, skillId: string, level: SkillLevel): Promise<Badge> {
    const badge = await this.prisma.badge.create({
      data: {
        userId,
        sessionId,
        level,
        verifyHash: randomBytes(12).toString('hex'),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 1.5), // 18 months
      },
    });

    const profile = await this.prisma.candidateProfile.findUnique({ where: { userId } });
    if (profile) {
      await this.prisma.skillClaim.upsert({
        where: { profileId_skillId: { profileId: profile.id, skillId } },
        update: { status: ClaimStatus.VERIFIED, level, badgeId: badge.id },
        create: { profileId: profile.id, skillId, level, status: ClaimStatus.VERIFIED, badgeId: badge.id },
      });
    }
    return badge;
  }
}
