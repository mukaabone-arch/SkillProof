import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { EmployerCandidateAccessModule } from '../access/employer-candidate-access.module';
import { PortfolioController } from './portfolio.controller';
import { EmployerPortfolioController } from './employer-portfolio.controller';
import { PortfolioService } from './portfolio.service';

@Module({
  imports: [AuthModule, LlmModule, EmployerCandidateAccessModule],
  controllers: [PortfolioController, EmployerPortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
