import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { LlmModule } from '../../llm/llm.module';
import { InterviewSessionsController } from './interview-sessions.controller';
import { InterviewSessionsService } from './interview-sessions.service';
import { InterviewFeedbackService } from './interview-feedback.service';
import { InterviewQuestionSelectorService } from './interview-question-selector.service';

@Module({
  imports: [AuthModule, EntitlementsModule, LlmModule],
  controllers: [InterviewSessionsController],
  providers: [InterviewSessionsService, InterviewFeedbackService, InterviewQuestionSelectorService],
})
export class InterviewSessionsModule {}
