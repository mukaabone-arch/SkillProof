import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { RagL2Claim } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UPLOAD_DIR } from '../../config/upload-dir';
import { EntitlementsService } from '../entitlements/entitlements.service';

const FILE_MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

interface EmbeddedFile {
  filename: string;
  mimeType: string;
  /** Base64-encoded file bytes — embedded rather than linked so the export is a self-contained portable artifact (see DataExportService's own doc comment on this choice). */
  base64: string;
}

/**
 * Builds the full "download my data" JSON payload — every category listed
 * in the feat/candidate-data-export brief, structured by category rather
 * than as raw table dumps. Scoping is always by this one candidate's
 * userId/CandidateProfile.id; nothing here ever joins across candidates.
 *
 * What's deliberately left out, and why (see this feature's own PR
 * description for the fuller reasoning on each):
 *  - Question.correct (the MCQ answer key) — never sent to any client,
 *    export included, same rule as everywhere else this field appears.
 *  - IntegrityEvent rows, Attempt.integrityStatus/integrityFlagCount,
 *    Attempt.reviewNote/reviewedByUserId — anti-cheat detection
 *    mechanics and admin-internal review commentary; AssessmentsService.
 *    getResult's own doc comment already establishes "no integrity
 *    fields in the candidate's own view" and this follows the same line.
 *    reviewOutcome/reviewedAt DO ship — that's a decision about the
 *    candidate's own attempt, not detection internals.
 *  - ClaimVerdict.modelVerdict/modelReason/modelConfidence,
 *    ClaimVerdict.reviewerId — never left ReviewService/AssessmentSessionsService.getResult
 *    either; the working verdict/reason (which IS what the candidate is
 *    already shown) ships instead.
 *  - SessionTurn.probeRung, TurnSignals — publicTurns() (the candidate's
 *    own existing transcript view) never includes either today.
 *  - ShortlistEntry.note/rejectReason, InterviewRound.note — explicitly
 *    documented as employer-only in interviews.service.ts's mineInclude;
 *    not the candidate's to see there, so not here either.
 *  - Employer/organization internals beyond the name already shown to
 *    the candidate elsewhere (GET /interviews/mine).
 */
@Injectable()
export class DataExportBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async build(candidateProfileId: string): Promise<Record<string, unknown>> {
    const profile = await this.prisma.candidateProfile.findUnique({ where: { id: candidateProfileId } });
    if (!profile) throw new NotFoundException('Candidate profile not found');
    const userId = profile.userId;

    const [
      user,
      accountActions,
      skillClaims,
      badges,
      attempts,
      sessions,
      certifications,
      externalCredentials,
      applications,
      shortlistEntries,
      subscription,
      usageCounters,
      notifications,
      interviewSessions,
      entitlementsSnapshot,
      photo,
      resume,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, phone: true, role: true, createdAt: true } }),
      this.prisma.accountAction.findMany({ where: { candidateProfileId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.skillClaim.findMany({ where: { profileId: candidateProfileId }, include: { skill: true } }),
      this.prisma.badge.findMany({ where: { userId }, include: { skill: true } }),
      this.prisma.attempt.findMany({
        where: { userId },
        include: {
          assessment: { include: { skill: true } },
          answers: { include: { question: true } },
          badge: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.assessmentSession.findMany({
        where: { userId },
        include: {
          turns: { orderBy: { createdAt: 'asc' } },
          claimVerdicts: true,
          disputes: true,
          liveClaimFeedback: true,
          badge: true,
        },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.certification.findMany({ where: { profileId: candidateProfileId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.externalCredential.findMany({ where: { profileId: candidateProfileId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.application.findMany({ where: { candidateProfileId }, include: { job: { include: { organization: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.shortlistEntry.findMany({
        where: { candidateId: candidateProfileId },
        include: { organization: true, job: true, rounds: { orderBy: { roundNumber: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.subscription.findUnique({ where: { candidateId: candidateProfileId } }),
      this.prisma.usageCounter.findMany({ where: { candidateId: candidateProfileId }, orderBy: { periodStart: 'asc' } }),
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.interviewSession.findMany({
        where: { userId },
        include: { turns: { orderBy: { createdAt: 'asc' } }, feedback: true, application: { include: { job: true } } },
        orderBy: { startedAt: 'asc' },
      }),
      this.entitlements.getEntitlements(userId).catch(() => null),
      embedFile(profile.photoKey),
      embedFile(profile.resumeS3Key),
    ]);

    const certFiles = await Promise.all(certifications.map((c) => embedFile(c.fileUrl)));

    return {
      exportedAt: new Date().toISOString(),
      account: {
        email: user.email,
        phone: user.phone,
        role: user.role,
        userCreatedAt: user.createdAt,
        status: profile.deletedAt ? 'deleted' : profile.deactivatedAt ? 'deactivated' : 'active',
        deactivatedAt: profile.deactivatedAt,
        deletedAt: profile.deletedAt,
        lifecycleHistory: accountActions.map((a) => ({
          type: a.type,
          reasonCategory: a.reasonCategory,
          reasonText: a.reasonText,
          createdAt: a.createdAt,
        })),
      },
      profile: {
        fullName: profile.fullName,
        headline: profile.headline,
        location: {
          city: profile.locationCity,
          region: profile.locationRegion,
          country: profile.locationCountry,
          lat: profile.locationLat,
          lng: profile.locationLng,
          legacyFreeText: profile.locationLegacy,
        },
        openToRemote: profile.openToRemote,
        yearsOfExp: profile.yearsOfExp,
        githubUrl: profile.githubUrl,
        linkedinUrl: profile.linkedinUrl,
        roleTitle: profile.roleTitle,
        roleTitleOther: profile.roleTitleOther,
        completeness: profile.completeness,
        emailNotifications: profile.emailNotifications,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        photo,
        resume,
      },
      skills: skillClaims.map((c) => ({
        skill: c.skill.name,
        level: c.level,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      badges: badges.map((b) => ({
        skill: b.skill.name,
        level: b.level,
        verifiedBy: b.verifiedBy,
        provenance: b.attemptId ? { type: 'MCQ_ATTEMPT', attemptId: b.attemptId, attemptNumber: b.attemptNumber } : { type: 'DISCUSSION_SESSION', sessionId: b.sessionId },
        verifyHash: b.verifyHash,
        issuedAt: b.issuedAt,
        expiresAt: b.expiresAt,
        revokedAt: b.revokedAt,
      })),
      mcqAssessments: attempts.map((a) => ({
        assessmentTitle: a.assessment.title,
        skill: a.assessment.skill.name,
        targetLevel: a.assessment.targetLevel,
        status: a.status,
        attemptNumber: a.attemptNumber,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        scorePercent: a.scorePercent,
        passed: a.passed,
        reviewOutcome: a.reviewOutcome,
        reviewedAt: a.reviewedAt,
        badgeIssued: a.badge != null,
        createdAt: a.createdAt,
        questions: a.answers.map((ans) => ({
          question: ans.question.body,
          yourAnswer: ans.answer,
          isCorrect: ans.isCorrect,
          answeredAt: ans.createdAt,
        })),
      })),
      discussionSessions: sessions.map((s) => ({
        status: s.status,
        skillBrief: s.pinnedBrief,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        scoredAt: s.scoredAt,
        decidedAt: s.decidedAt,
        decisionNote: s.decisionNote,
        badgeIssued: s.badge != null,
        transcript: s.turns.map((t) => ({
          role: t.role,
          content: t.content,
          claim: t.claimId,
          superseded: t.superseded,
          createdAt: t.createdAt,
        })),
        claimVerdicts: CLAIM_ORDER.filter((claimId) => s.claimVerdicts.some((v) => v.claimId === claimId)).map((claimId) => {
          const v = s.claimVerdicts.find((cv) => cv.claimId === claimId)!;
          return {
            claim: v.claimId,
            verdict: v.reviewerVerdict ?? v.verdict,
            bandBoundary: v.bandBoundary,
            reason: v.reviewerNote?.trim() ? v.reviewerNote : v.reason,
            evidenceQuoted: v.spans,
            reviewedAt: v.reviewedAt,
          };
        }),
        disputes: s.disputes.map((d) => ({
          claim: d.claimId,
          body: d.body,
          createdAt: d.createdAt,
          resolvedAt: d.resolvedAt,
          resolution: d.resolution,
          upheld: d.upheld,
        })),
        liveCoachingFeedback: s.liveClaimFeedback.map((f) => ({
          claim: f.claimId,
          verdictLabel: f.verdictLabel,
          verdictTone: f.verdictTone,
          summary: f.summary,
          strengths: f.strengths,
          gaps: f.gaps,
        })),
      })),
      interviewPracticeSessions: interviewSessions.map((s) => ({
        status: s.status,
        appliedToJob: s.application?.job?.title ?? null,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        transcript: s.turns.map((t) => ({
          role: t.role,
          content: t.content,
          phase: t.phase,
          superseded: t.superseded,
          createdAt: t.createdAt,
        })),
        feedback: s.feedback.map((f) => ({
          summary: f.summary,
          strengths: f.strengths,
          improvements: f.improvements,
          missingStarElement: f.missingStarElement,
          createdAt: f.createdAt,
        })),
      })),
      certifications: certifications.map((c, i) => ({
        name: c.name,
        issuer: c.issuer,
        issuerOther: c.issuerOther,
        issueDate: c.issueDate,
        expiryDate: c.expiryDate,
        credentialId: c.credentialId,
        credentialUrl: c.credentialUrl,
        verificationStatus: c.verificationStatus,
        verificationSource: c.verificationSource,
        skillTags: c.skillTags,
        createdAt: c.createdAt,
        file: certFiles[i],
      })),
      externalCredentials: externalCredentials.map((c) => ({
        issuer: c.issuer,
        name: c.name,
        credentialUrl: c.credentialUrl,
        verificationState: c.verificationState,
        verifiedAt: c.verifiedAt,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        createdAt: c.createdAt,
      })),
      applications: applications.map((a) => ({
        jobTitle: a.job.title,
        organization: a.job.organization.name,
        status: a.status,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
      hiringPipelineHistory: shortlistEntries.map((e) => ({
        organization: e.organization.name,
        job: e.job?.title ?? null,
        stage: e.stage,
        inviteMessage: e.inviteMessage,
        candidateResponse: e.candidateResponse,
        rounds: e.rounds.map((r) => ({
          roundNumber: r.roundNumber,
          status: r.status,
          channel: r.channel,
          scheduledAt: r.scheduledAt,
        })),
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
      subscription: {
        current: subscription
          ? {
              tier: subscription.tier,
              status: subscription.status,
              currentPeriodStart: subscription.currentPeriodStart,
              currentPeriodEnd: subscription.currentPeriodEnd,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
              createdAt: subscription.createdAt,
              updatedAt: subscription.updatedAt,
            }
          : { tier: 'FREE', note: 'No subscription row exists — a candidate with none is always FREE.' },
        effectiveTierNow: entitlementsSnapshot?.tier ?? null,
        // Monthly usage-counter history — the closest thing to "subscription
        // history" that exists anywhere in this schema. There is no
        // tier-change/billing-event log to include; see this builder's own
        // doc comment / the feature's PR description for why.
        usageHistory: usageCounters.map((u) => ({ metric: u.metric, periodStart: u.periodStart, count: u.count })),
      },
      notifications: notifications.map((n) => ({
        type: n.type,
        subject: n.subject,
        status: n.status,
        sentAt: n.sentAt,
        createdAt: n.createdAt,
      })),
    };
  }
}

const CLAIM_ORDER: RagL2Claim[] = [
  RagL2Claim.CHUNKING,
  RagL2Claim.DIAGNOSIS,
  RagL2Claim.RERANKING,
  RagL2Claim.CORPUS_CHANGE,
  RagL2Claim.EVALUATION,
  RagL2Claim.COST,
];

async function embedFile(filename: string | null): Promise<EmbeddedFile | null> {
  if (!filename) return null;
  try {
    const buffer = await fs.readFile(join(UPLOAD_DIR, filename));
    const ext = extname(filename).toLowerCase();
    return { filename, mimeType: FILE_MIME_BY_EXTENSION[ext] ?? 'application/octet-stream', base64: buffer.toString('base64') };
  } catch {
    // A stored key with no readable file on disk (ephemeral-disk redeploy
    // wipe, manual cleanup — see UPLOAD_DIR's own doc comment) must not
    // fail the whole export; the rest of the candidate's data still ships.
    return null;
  }
}
