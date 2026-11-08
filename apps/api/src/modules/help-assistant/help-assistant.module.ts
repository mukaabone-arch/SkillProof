import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../../llm/llm.module';
import { HelpAssistantController } from './help-assistant.controller';
import { HelpAssistantService } from './help-assistant.service';

@Module({
  imports: [AuthModule, LlmModule],
  controllers: [HelpAssistantController],
  providers: [HelpAssistantService],
})
export class HelpAssistantModule {}
