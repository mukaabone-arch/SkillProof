import { Module } from '@nestjs/common';
import { EmployerCandidateAccessService } from './employer-candidate-access.service';

@Module({
  providers: [EmployerCandidateAccessService],
  exports: [EmployerCandidateAccessService],
})
export class EmployerCandidateAccessModule {}
