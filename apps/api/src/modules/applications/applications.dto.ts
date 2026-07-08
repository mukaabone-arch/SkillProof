import { ApplicationStatus } from '@prisma/client';
import { IsIn } from 'class-validator';

/** APPLIED is the initial state and WITHDRAWN is candidate-initiated only — an employer can only move an application through these. */
const EMPLOYER_SETTABLE_STATUSES = [
  ApplicationStatus.REVIEWED,
  ApplicationStatus.SHORTLISTED,
  ApplicationStatus.REJECTED,
] as const;

export class UpdateApplicationStatusDto {
  @IsIn(EMPLOYER_SETTABLE_STATUSES)
  status: ApplicationStatus;
}
