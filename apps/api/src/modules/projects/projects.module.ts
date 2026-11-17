import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectReportService } from './project-report.service';

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectReportService],
})
export class ProjectsModule {}
