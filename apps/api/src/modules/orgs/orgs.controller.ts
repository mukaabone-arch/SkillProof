import { Controller, Get, NotFoundException, Req, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';

@Controller('orgs')
export class OrgsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { userId: req.user.sub },
      include: { organization: true },
    });
    if (!membership) throw new NotFoundException('No organization found for this account.');

    return {
      organization: membership.organization,
      role: req.user.role,
    };
  }
}
