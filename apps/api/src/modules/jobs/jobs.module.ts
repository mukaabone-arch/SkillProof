import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { MatchingService } from './matching.service';
import { CandidateJobsController } from './candidate-jobs.controller';
import { CandidateJobsService } from './candidate-jobs.service';

@Module({
  imports: [AuthModule, LlmModule],
  controllers: [JobsController, CandidateJobsController],
  providers: [JobsService, MatchingService, CandidateJobsService],
})
export class JobsModule {}
