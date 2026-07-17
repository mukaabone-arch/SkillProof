import { Verdict } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, MaxLength, ValidateNested } from 'class-validator';

/**
 * Composition telemetry for one candidate turn — see the TurnSignals model's
 * doc comment for what each field means and why every one of them is
 * optional. A client that doesn't report signals at all simply omits this
 * object entirely; postTurn persists no TurnSignals row in that case rather
 * than failing the turn.
 */
export class TurnSignalsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  pasteCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pastedCharCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  largestPasteChars?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  timeToFirstKeystrokeMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  compositionDurationMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  charCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  effectiveWpm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  blurCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  blurDurationMs?: number;
}

export class PostSessionTurnDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TurnSignalsDto)
  signals?: TurnSignalsDto;
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

/** Body for POST /assessment-sessions/:id/claims/:claimId/feedback-vote. */
export class LiveFeedbackVoteDto {
  @IsBoolean()
  helpful: boolean;
}

/** Body for POST /assessment-sessions/:id/claims/:claimId/dispute/resolve. */
export class ResolveDisputeDto {
  @IsBoolean()
  upheld: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  resolution: string;
}
