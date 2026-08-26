import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from './jwt-auth.guard';
import { SKIP_VERIFICATION_GATE_KEY } from './skip-verification-gate.decorator';
import { assertCandidateVerified } from './candidate-verification-readiness';

/**
 * Enforces candidate-verification-readiness.ts's gate: a CANDIDATE must
 * have both a verified phone and a verified email before touching anything
 * else in the app. Deliberately NOT attached per-controller the way
 * OrgSetupCompleteGuard is — this gate's blast radius is nearly every
 * candidate route (profiles, assessments, jobs, applications, badges,
 * subscriptions, ...), and OrgSetupCompleteGuard's own doc comment already
 * admits "there's no partial-route exemption mechanism" for that pattern,
 * which is fine for the 5 controllers it covers but would mean manually
 * remembering to attach a new guard to 15+ controllers today and every
 * candidate controller added in the future — exactly the kind of gap a
 * *hard* gate can't tolerate.
 *
 * Instead, JwtAuthGuard itself calls this guard's canActivate once it has
 * set req.user — see that file's own doc comment. Every authenticated
 * route already depends on JwtAuthGuard, so this is the one choke point
 * that structurally cannot be missed. Kept as its own single-purpose class
 * (own file, own tests) rather than inlined into JwtAuthGuard, matching
 * this codebase's one-guard-one-concern convention (RolesGuard,
 * OrgMemberGuard, EntitlementGuard, OrgSetupCompleteGuard).
 *
 * No-ops for non-candidates (role check first, before the skip-decorator
 * check even runs) — employers and platform admins are never touched by
 * this regardless of what's decorated where.
 */
@Injectable()
export class CandidateVerificationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.user.role !== Role.CANDIDATE) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_VERIFICATION_GATE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { phone: true, email: true },
    });
    // A vanished user (deleted between token issue and this request) isn't
    // this guard's problem to diagnose — let the downstream handler's own
    // lookup fail naturally instead of masking it behind a verification error.
    if (!user) return true;

    assertCandidateVerified(user);
    return true;
  }
}
