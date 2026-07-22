import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileViewsModule } from '../profile-views/profile-views.module';
import { CandidatesController } from './candidates.controller';
import { CandidatesService } from './candidates.service';

@Module({
  imports: [AuthModule, ProfileViewsModule],
  controllers: [CandidatesController],
  providers: [CandidatesService],
})
export class CandidatesModule {}
