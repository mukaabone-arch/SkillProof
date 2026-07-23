import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InterviewQuestionsController } from './interview-questions.controller';
import { InterviewQuestionsService } from './interview-questions.service';

@Module({
  imports: [AuthModule],
  controllers: [InterviewQuestionsController],
  providers: [InterviewQuestionsService],
})
export class InterviewQuestionsModule {}
