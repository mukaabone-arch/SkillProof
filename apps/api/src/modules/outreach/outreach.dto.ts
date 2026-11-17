import { RecruiterContactPreference } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { MESSAGE_MAX_CHARS, WEEKLY_LIMIT_MAX, WEEKLY_LIMIT_MIN } from './outreach.util';

export class CreateOutreachCampaignDto {
  @IsUUID()
  jobId!: string;
}

export class UpdateOutreachMessageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_CHARS)
  body?: string;

  /** true = leave this candidate out of the batch; false = put them back. */
  @IsOptional()
  @IsBoolean()
  skip?: boolean;
}

export class SendOutreachDto {
  /** Send only these drafts; omitted = every draft in the campaign. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  messageIds?: string[];
}

export class SetCampaignStatusDto {
  @IsIn(['ACTIVE', 'PAUSED', 'CLOSED'])
  status!: 'ACTIVE' | 'PAUSED' | 'CLOSED';
}

export class RespondOutreachDto {
  @IsIn(['INTERESTED', 'NOT_NOW', 'NOT_INTERESTED'])
  response!: 'INTERESTED' | 'NOT_NOW' | 'NOT_INTERESTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateOutreachPreferencesDto {
  @IsOptional()
  @IsIn(Object.values(RecruiterContactPreference))
  recruiterContact?: RecruiterContactPreference;

  @IsOptional()
  @IsInt()
  @Min(WEEKLY_LIMIT_MIN)
  @Max(WEEKLY_LIMIT_MAX)
  outreachWeeklyLimit?: number;
}

export class UnsubscribeOutreachDto {
  @IsUUID()
  u!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  t!: string;
}
