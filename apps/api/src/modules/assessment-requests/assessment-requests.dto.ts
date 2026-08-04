import { IsEnum, IsString } from 'class-validator';
import { SkillLevel } from '@prisma/client';

/** Employer: initiate an assessment request for a shortlisted candidate — see AssessmentRequestsService.initiate. */
export class InitiateAssessmentRequestDto {
  /** CandidateProfile.id */
  @IsString()
  candidateId: string;

  @IsString()
  skillId: string;

  @IsEnum(SkillLevel)
  level: SkillLevel;
}

/**
 * Employer: the three values Razorpay Checkout hands back to the client's
 * success handler — deliberately NOT candidateId/skillId/level too; those
 * are read back from the Razorpay order's own `notes` (pinned server-side
 * at InitiateAssessmentRequestDto time) rather than trusted from whatever
 * the client resubmits here. See AssessmentRequestsService.verifyAndCreate.
 */
export class VerifyAssessmentRequestPaymentDto {
  @IsString()
  razorpay_order_id: string;

  @IsString()
  razorpay_payment_id: string;

  @IsString()
  razorpay_signature: string;
}
