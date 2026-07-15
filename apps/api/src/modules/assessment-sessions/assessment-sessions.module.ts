import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AssessmentSessionsController } from './assessment-sessions.controller';
import { AssessmentSessionsService } from './assessment-sessions.service';
import { AssessorService } from './assessor.service';

@Module({
  imports: [AuthModule],
  controllers: [AssessmentSessionsController],
  providers: [AssessmentSessionsService, AssessorService],
})
export class AssessmentSessionsModule {}
