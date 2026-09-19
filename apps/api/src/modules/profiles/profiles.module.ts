import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { EmployerCandidateAccessModule } from '../access/employer-candidate-access.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [AuthModule, LlmModule, EmployerCandidateAccessModule, PortfolioModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
