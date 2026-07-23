import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** Body for POST /interview-sessions. Both optional — an omitted
 * applicationId falls back to the candidate's own most recent application
 * (see InterviewSessionsService.resolveGrounding); no application at all
 * just means the session isn't company-grounded, never an error. */
export class CreateInterviewSessionDto {
  @IsOptional()
  @IsUUID()
  applicationId?: string;
}

/** Body for POST /interview-sessions/:id/turns. */
export class PostInterviewTurnDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}
