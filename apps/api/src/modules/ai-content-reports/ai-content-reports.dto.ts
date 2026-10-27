import { AiContentReportReason, AiContentTarget } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** POST /ai-content-reports — see AiContentReportsService.create. */
export class CreateAiContentReportDto {
  @IsUUID()
  sessionId: string;

  @IsEnum(AiContentTarget)
  targetType: AiContentTarget;

  /** SessionTurn id, LiveClaimFeedback id, or the claim key for RESULT_REASON. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  targetId: string;

  @IsEnum(AiContentReportReason)
  reason: AiContentReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** POST /admin/ai-content-reports/:id/review */
export class ReviewAiContentReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string;
}
