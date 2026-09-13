import { IsEnum, IsString } from 'class-validator';
import { SkillLevel } from '@prisma/client';

/**
 * Employer: request a whole skill for a shortlisted candidate — see
 * AssessmentRequestsService.create. No `level` (2026-09-14, outcome-priced
 * rework) — the candidate works through every level the skill offers, and
 * the charge depends on how far they get, not on a level picked up front.
 * Postpaid — no separate verify step exists, and nothing is charged by this
 * call at all (see AssessmentRequestsService.settle for when it is).
 */
export class InitiateAssessmentRequestDto {
  /** CandidateProfile.id */
  @IsString()
  candidateId: string;

  @IsString()
  skillId: string;
}

/** Candidate: which of the request's levels they're starting — see AssessmentRequestsService.startFromRequest. */
export class StartAssessmentRequestLevelDto {
  @IsEnum(SkillLevel)
  level: SkillLevel;
}
