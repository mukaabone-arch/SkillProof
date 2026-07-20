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
    const { passwordHash, profile, ...safe } = user;
    // photoKey is a storage key, never handed to a client — see
    // ProfilesService.withHasPhoto for the same rule on /profiles/me.
    // Clients fetch actual bytes only via GET /profiles/:id/photo.
    const safeProfile = profile
      ? (() => {
          const { photoKey, ...rest } = profile;
          return { ...rest, hasPhoto: photoKey != null };
        })()
      : null;
    return { ...safe, profile: safeProfile };
  }
}
