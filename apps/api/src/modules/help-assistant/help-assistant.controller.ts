import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipVerificationGate } from '../auth/skip-verification-gate.decorator';
import { HelpAssistantService } from './help-assistant.service';
import { AskHelpDto } from './help-assistant.dto';

/**
 * Any signed-in user. Exempt from the candidate verification gate: someone
 * stuck mid-verification is exactly who needs help.
 */
@Controller('help')
@UseGuards(JwtAuthGuard)
@SkipVerificationGate()
export class HelpAssistantController {
  constructor(private readonly help: HelpAssistantService) {}

  @Post('ask')
  @HttpCode(200)
  ask(@Req() req: AuthenticatedRequest, @Body() dto: AskHelpDto) {
    return this.help.ask(req.user.sub, req.user.role, dto);
  }
}
