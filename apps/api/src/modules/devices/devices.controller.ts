import { Body, Controller, Delete, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SkipVerificationGate } from '../auth/skip-verification-gate.decorator';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './devices.dto';

/**
 * Candidate app installs. Exempt from the verification gate: the app
 * registers right after sign-in, which can be before a candidate has
 * finished verification, and sign-out must always be able to unregister.
 */
@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CANDIDATE)
@SkipVerificationGate()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(200)
  register(@Req() req: AuthenticatedRequest, @Body() dto: RegisterDeviceDto) {
    return this.devices.register(req.user.sub, dto);
  }

  @Delete(':token')
  unregister(@Req() req: AuthenticatedRequest, @Param('token') token: string) {
    return this.devices.unregister(req.user.sub, token);
  }
}
