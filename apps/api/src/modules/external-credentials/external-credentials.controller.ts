import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ExternalCredentialsService } from './external-credentials.service';
import { CreateExternalCredentialDto } from './external-credentials.dto';

@Controller('profiles/me/external-credentials')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
export class ExternalCredentialsController {
  constructor(private readonly svc: ExternalCredentialsService) {}

  @Post()
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateExternalCredentialDto) {
    return this.svc.create(req.user.sub, dto);
  }

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.svc.list(req.user.sub);
  }

  @Delete(':id')
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.svc.remove(req.user.sub, id);
  }
}
