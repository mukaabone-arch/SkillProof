import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { WEBHOOK_EVENTS } from '../webhooks/webhooks.util';

export class CreateWebhookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS as unknown as string[], { each: true })
  events!: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS as unknown as string[], { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;
}

/** API v1: move a shortlist entry on (employers). INTERVIEWING is the candidate's own answer to an invite, so it isn't settable. */
export class PipelineActionDto {
  @IsIn(['invite', 'offer', 'hire', 'close', 'reject'])
  action!: 'invite' | 'offer' | 'hire' | 'close' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** API v1: move a submission on (recruiters). Same rules as the Submissions page. */
export class SubmissionStatusDto {
  @IsIn(['INTERVIEWING', 'OFFER', 'PLACED', 'NOT_SELECTED', 'WITHDRAWN'])
  status!: 'INTERVIEWING' | 'OFFER' | 'PLACED' | 'NOT_SELECTED' | 'WITHDRAWN';
}
