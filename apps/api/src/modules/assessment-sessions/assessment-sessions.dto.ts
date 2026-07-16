import { Verdict } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class PostSessionTurnDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

/** Body for POST /assessment-sessions/:id/claims/:claimId/review — Verdict includes the reviewer-only INSUFFICIENT_PROBING. */
export class ReviewClaimDto {
  @IsEnum(Verdict)
  verdict: Verdict;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** Body for POST /assessment-sessions/:id/decision. */
export class SessionDecisionDto {
  @IsIn(['ISSUE', 'REJECT'])
  decision: 'ISSUE' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/** Body for POST /assessment-sessions/:id/claims/:claimId/dispute. */
export class DisputeClaimDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;
}
