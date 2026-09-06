import { IsEnum, IsString } from 'class-validator';
import { SkillLevel } from '@prisma/client';

/** Employer: create an assessment request for a shortlisted candidate — see AssessmentRequestsService.create. Postpaid (2026-09) — no separate verify step exists; this one call both creates the request and accrues its charge. */
export class InitiateAssessmentRequestDto {
  /** CandidateProfile.id */
  @IsString()
  candidateId: string;

  @IsString()
  skillId: string;

  @IsEnum(SkillLevel)
  level: SkillLevel;
}
