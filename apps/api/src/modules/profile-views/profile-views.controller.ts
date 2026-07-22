import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfileViewsService } from './profile-views.service';

@Controller('profiles/me/viewers')
@UseGuards(JwtAuthGuard)
export class ProfileViewsController {
  constructor(private readonly svc: ProfileViewsService) {}

  @Get()
  get(@Req() req: AuthenticatedRequest) {
    return this.svc.getViewersForCandidate(req.user.sub);
  }
}
