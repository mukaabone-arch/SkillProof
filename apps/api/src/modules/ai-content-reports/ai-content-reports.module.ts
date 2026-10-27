import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiContentReportsController } from './ai-content-reports.controller';
import { AiContentReportsService } from './ai-content-reports.service';

/** In-app reporting of AI-generated content — see AiContentReportsService. */
@Module({
  imports: [AuthModule],
  controllers: [AiContentReportsController],
  providers: [AiContentReportsService],
  exports: [AiContentReportsService],
})
export class AiContentReportsModule {}
