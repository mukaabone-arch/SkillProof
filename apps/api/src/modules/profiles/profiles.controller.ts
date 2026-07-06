import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { ProfilesService } from './profiles.service';
import { UpdateProfileDto } from './profiles.dto';

@Controller('profiles')
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private readonly svc: ProfilesService) {}

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.svc.getMe(req.user.sub);
  }

  @Patch('me')
  update(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.svc.updateMe(req.user.sub, dto);
  }
}
