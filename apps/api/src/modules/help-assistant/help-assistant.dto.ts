import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export const HELP_PLATFORMS = ['web', 'android', 'ios'] as const;
export type HelpPlatform = (typeof HELP_PLATFORMS)[number];

export const HELP_AUDIENCES = ['candidate', 'employer', 'recruiter'] as const;
export type HelpAudienceKey = (typeof HELP_AUDIENCES)[number];

/** A user question is capped at 1,000 characters in the service; 4,000 here leaves room for earlier answers. */
export class HelpTurnDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

/** POST /help/ask — the conversation so far, oldest first, ending with the new question. */
export class AskHelpDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HelpTurnDto)
  messages: HelpTurnDto[];

  @IsOptional()
  @IsIn(HELP_PLATFORMS)
  platform?: HelpPlatform;

  /** Honoured for platform admins only (to try each guide); everyone else gets the guide for their own role. */
  @IsOptional()
  @IsIn(HELP_AUDIENCES)
  audience?: HelpAudienceKey;
}
