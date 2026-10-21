import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CopilotService } from './copilot.service';

/** IANA zone names are short and limited to this alphabet; anything else is ignored (falls back to Asia/Kolkata). */
const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

/**
 * Candidate co-pilot. Phase 1 is read-only: GET /copilot/plan returns the
 * ordered next steps; any action a step offers still goes through its own
 * existing endpoint (e.g. POST /assessment-requests/mine/:id/start), so every
 * existing guard, entitlement check and plan limit keeps applying unchanged.
 */
@Controller('copilot')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class CopilotController {
  constructor(private readonly svc: CopilotService) {}

  /** `?tz=Asia/Kolkata` — the client's zone, used only to format interview times. */
  @Get('plan')
  plan(@Req() req: AuthenticatedRequest, @Query('tz') tz?: string) {
    return this.svc.getPlan(req.user.sub, tz && TIME_ZONE_PATTERN.test(tz) ? tz : undefined);
  }
}
