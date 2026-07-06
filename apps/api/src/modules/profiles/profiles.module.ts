import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

@Module({
  imports: [AuthModule, LlmModule],
  controllers: [ProfilesController],
  providers: [ProfilesService],
})
export class ProfilesModule {}
