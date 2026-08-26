import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { CandidateVerificationGuard } from './candidate-verification.guard';

export interface AuthenticatedRequest extends Request {
  user: { sub: string; role: string };
}

/**
 * Also runs CandidateVerificationGuard's check inline, once req.user is
 * set — not attached as a separate @UseGuards entry per-controller. See
 * that guard's own doc comment for why: every authenticated route already
 * depends on JwtAuthGuard, which makes this the one choke point a new
 * candidate-facing route structurally cannot skip. A no-op for anyone not
 * mid-way through a genuine token check (the guard itself no-ops for
 * non-candidates and skip-decorated routes) — this never changes what
 * "authenticated" means, only what an already-authenticated CANDIDATE may
 * do next.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly candidateVerification: CandidateVerificationGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      req.user = await this.jwt.verifyAsync(token, { secret: process.env.JWT_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.candidateVerification.canActivate(context);
  }
}
