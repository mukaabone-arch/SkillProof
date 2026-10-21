import { Injectable, Logger } from '@nestjs/common';
import { ClaimStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { APPLY_GATE_REQUIRED_LEVELS } from '../../config/apply-gate.config';
import { BadgeResolverService } from '../badges/badge-resolver.service';
import { CandidateJobsService } from '../jobs/candidate-jobs.service';
import { AssessmentsService } from '../assessments/assessments.service';
import { AssessmentSessionsService } from '../assessment-sessions/assessment-sessions.service';
import { InterviewsService } from '../interviews/interviews.service';
import { AssessmentRequestsService } from '../assessment-requests/assessment-requests.service';
import {
  buildCopilotPlan,
  CopilotPlan,
  CopilotSignals,
  EmployerInviteSignal,
  InterviewSignal,
  PipelineStage,
} from './copilot-plan';

/**
 * Gathers the same signals apps/web/components/Dashboard.tsx fetched from
 * eight separate endpoints, by calling the SAME service methods those
 * endpoints call — so the plan can never disagree with what the rest of the
 * dashboard (and the apply/assessment gates) see. The decision logic itself
 * lives in copilot-plan.ts.
 *
 * Read-only apart from what those methods already do on every dashboard load
 * (AssessmentRequestsService.listForCandidate's pull-based reconcile).
 */
@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly badgeResolver: BadgeResolverService,
    private readonly candidateJobs: CandidateJobsService,
    private readonly assessments: AssessmentsService,
    private readonly sessions: AssessmentSessionsService,
    private readonly interviews: InterviewsService,
    private readonly assessmentRequests: AssessmentRequestsService,
  ) {}

  async getPlan(userId: string, timeZone?: string, now: Date = new Date()): Promise<CopilotPlan> {
    return buildCopilotPlan(await this.gatherSignals(userId, timeZone, now));
  }

  async gatherSignals(userId: string, timeZone: string | undefined, now: Date): Promise<CopilotSignals> {
    // Read, never create — unlike ProfilesService.getMe (ensureProfile). A
    // missing row reads exactly like completeness 0, which is what the
    // dashboard's `profile.completeness > 0` saw for a fresh profile.
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { id: true, completeness: true },
    });

    const [hasBadge, applicationCount, applyGate, live, matched, interviews, session, invites] = await Promise.all([
      // Dashboard: me.profile.skillClaims.filter(c => c.status === 'VERIFIED' && c.badge)
      profile
        ? this.prisma.skillClaim
            .count({ where: { profileId: profile.id, status: ClaimStatus.VERIFIED, badgeId: { not: null } } })
            .then((n: number) => n > 0)
        : Promise.resolve(false),
      profile ? this.prisma.application.count({ where: { candidateProfileId: profile.id } }) : Promise.resolve(0),
      // Same primitive that backs both GET /me/entitlements' applyGate and the apply-time enforcement.
      this.badgeResolver.resolveApplyGateProgress(userId, APPLY_GATE_REQUIRED_LEVELS).catch((e) => {
        this.logger.warn(`applyGate unavailable for ${userId}: ${(e as Error).message}`);
        return null; // buildCopilotPlan falls back to hasBadge, same as the dashboard while entitlements load
      }),
      this.assessments.listLive(),
      this.candidateJobs.matched(userId),
      // The next three were best-effort on the dashboard (.catch(() => [])/null) — same here.
      this.interviews.listMine(userId).catch(() => []),
      this.sessions.getMine(userId).catch(() => null),
      this.assessmentRequests.listForCandidate(userId).catch(() => []),
    ]);

    return {
      hasProfile: (profile?.completeness ?? 0) > 0,
      hasBadge,
      applyGate: applyGate
        ? {
            met: applyGate.met,
            progress: applyGate.progress
              ? {
                  skillName: applyGate.progress.skillName,
                  levelNamesHeld: applyGate.progress.levelNamesHeld,
                  levelNamesRemaining: applyGate.progress.levelNamesRemaining,
                }
              : null,
          }
        : null,
      liveAssessmentCount: live.filter((a) => a._count.questions > 0).length,
      interviews: interviews.map(
        (i): InterviewSignal => ({
          orgName: i.orgName,
          job: i.job,
          stage: i.stage as PipelineStage,
          currentRound: i.currentRound
            ? { roundNumber: i.currentRound.roundNumber, channel: i.currentRound.channel, scheduledAt: i.currentRound.scheduledAt }
            : null,
          candidateResponse: (i.candidateResponse ?? null) as InterviewSignal['candidateResponse'],
        }),
      ),
      assessmentSession: session ? { id: session.id, status: session.status } : null,
      employerInvites: (invites as any[]).map(
        (r): EmployerInviteSignal => ({
          id: r.id,
          level: r.level ?? null,
          status: r.status,
          expiresAt: r.expiresAt ?? null,
          startedAt: r.startedAt ?? null,
          durationMins: r.durationMins ?? null,
          submitted: r.submitted ?? false,
          skill: { name: r.skill?.name ?? 'a skill' },
          organization: { name: r.organization?.name ?? 'An employer' },
        }),
      ),
      matchedJobs: matched.jobs.map((j) => ({
        id: j.id,
        title: j.title,
        orgName: j.orgName,
        score: j.score,
        alreadyApplied: j.alreadyApplied,
        missing: j.missing.map((m) => ({ skillId: m.skillId, skillName: m.skillName })),
      })),
      applicationCount,
      now,
      timeZone,
    };
  }
}
