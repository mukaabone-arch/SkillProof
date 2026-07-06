import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [AuthModule, LlmModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
