import { AccountActionType, IntegrityStatus, ReviewOutcome, SkillLevel, SubscriptionStatus, SubscriptionTier } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAssessmentDto {
  @IsUUID()
  skillId: string;

  @IsString()
  @MaxLength(160)
  title: string;

  @IsEnum(SkillLevel)
  targetLevel: SkillLevel;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  durationMins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  questionsPerAttempt?: number;

  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;

  @IsOptional()
  @IsBoolean()
  isLive?: boolean;
}

export class UpdateAssessmentDto {
  @IsOptional()
  @IsUUID()
  skillId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsEnum(SkillLevel)
  targetLevel?: SkillLevel;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  durationMins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  passThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  questionsPerAttempt?: number;

  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;

  @IsOptional()
  @IsBoolean()
  isLive?: boolean;
}

export class CreateQuestionDto {
  @IsString()
  @MaxLength(2000)
  text: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  options: string[];

  @IsInt()
  @Min(0)
  correctIndex: number;

  @IsInt()
  @Min(1)
  @Max(5)
  difficulty: number;
}

/**
 * One item of a bulk import batch. Deliberately loose about what a caller
 * may send — our generation pipeline attaches extra fields (rationale,
 * sourceRef, etc.) that we accept and simply never read. Only these four are
 * ever used; `class-transformer` copies the rest onto the instance but they
 * never reach the create() call.
 */
export class BulkQuestionItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  options: string[];

  @IsInt()
  @Min(0)
  correctIndex: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;
}

export class ListAttemptsQueryDto {
  @IsOptional()
  @IsEnum(IntegrityStatus)
  status?: IntegrityStatus;
}

/**
 * Compliance Center / Privacy Requests filters — see
 * AccountService.listActionsForAdmin. `status` filters on a *derived*
 * flag (needsAttention), not a stored column: AccountAction itself has no
 * status field, so "incomplete" is computed live from correlated
 * Notification/AssessmentRequest state at read time — see that method's
 * own doc comment for exactly what feeds it.
 */
export class ListAccountActionsQueryDto {
  @IsOptional()
  @IsEnum(AccountActionType)
  type?: AccountActionType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(['ALL', 'NEEDS_ATTENTION', 'CLEAN'])
  status?: 'ALL' | 'NEEDS_ATTENTION' | 'CLEAN';
}

/** Admin decision on a FLAGGED attempt — the only thing that can invalidate an attempt/badge. */
export class ReviewAttemptDto {
  @IsEnum(ReviewOutcome)
  outcome: ReviewOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/**
 * Manual tier assignment — foundation work for testing entitlements before
 * any payment provider exists. See EntitlementsService.setTierManually.
 */
export class SetSubscriptionDto {
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;

  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsDateString()
  currentPeriodEnd?: string;

  @IsOptional()
  @IsBoolean()
  cancelAtPeriodEnd?: boolean;
}
