import { InterviewRoundStatus, ShortlistStage } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class InviteDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class RejectDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class AddRoundDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  channel?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class UpdateRoundDto {
  @IsOptional()
  @IsEnum(InterviewRoundStatus)
  status?: InterviewRoundStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  channel?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

const OUTCOME_STAGES = [ShortlistStage.HIRED, ShortlistStage.CLOSED] as const;

export class OutcomeDto {
  @IsIn(OUTCOME_STAGES)
  outcome: (typeof OUTCOME_STAGES)[number];
}
