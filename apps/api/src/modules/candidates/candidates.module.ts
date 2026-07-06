import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';

@Module({
  imports: [AuthModule],
  controllers: [CandidatesController],
  providers: [CandidatesService],
})
export class CandidatesModule {}
