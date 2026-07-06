import { Controller, Get, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      include: {
        profile: {
          include: { skillClaims: { include: { skill: true, badge: true } } },
        },
      },
    });
    if (!user || user.deletedAt) throw new NotFoundException();
    const { passwordHash, ...safe } = user;
    return safe;
  }
}
