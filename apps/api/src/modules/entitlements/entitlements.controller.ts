import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EntitlementsService } from './entitlements.service';

/** See this module's README.md for the GET /me/entitlements response-shape contract both clients render gates from. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class EntitlementsController {
  constructor(private readonly svc: EntitlementsService) {}

  @Get('entitlements')
  get(@Req() req: AuthenticatedRequest) {
    return this.svc.getEntitlements(req.user.sub);
  }
}
