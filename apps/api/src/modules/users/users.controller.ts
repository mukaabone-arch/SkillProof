import { Controller, Get, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { SkipVerificationGate } from '../auth/skip-verification-gate.decorator';
import { CLIENT_COUNTRY_HEADER, recordClientCountry } from '../auth/client-country';
import { missingVerificationFields, phoneRequired } from '../auth/candidate-verification-readiness';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Exempt from CandidateVerificationGuard — this is what both the gate's
   * own server-side check and the /verify screen read phone/email status
   * from; a gated candidate must still be able to see what they're missing.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipVerificationGate()
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
    // The clients call this first after sign-in, so this is where a new
    // candidate's country is usually recorded (see client-country.ts).
    user.country = await recordClientCountry(this.prisma, user.id, user.country, req.headers[CLIENT_COUNTRY_HEADER]);
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
    // phoneRequired / missingVerification: what the verify screens need, so
    // the clients never re-derive the rule (older app builds that ignore
    // these keep requiring both, which only errs on the strict side).
    return {
      ...safe,
      profile: safeProfile,
      phoneRequired: phoneRequired(user),
      missingVerification: missingVerificationFields(user),
    };
  }
}
