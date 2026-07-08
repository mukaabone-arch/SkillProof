import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ApplicationsService } from './applications.service';

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.svc.listMine(req.user.sub);
  }
}
