import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Passkey, Role } from '@prisma/client';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoUint8Array } from '@simplewebauthn/server/helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_PASSKEYS_PER_USER = 10;
const EMPLOYER_ROLES: Role[] = [Role.EMPLOYER_ADMIN, Role.EMPLOYER_MEMBER];

/**
 * WEBAUTHN_RP_ID is the domain passkeys are bound to — 'myambii.com' (no
 * www) in production so they work on www, the bare domain, and later the
 * mobile apps. NEVER change it once users have passkeys: every existing
 * passkey would stop working. WEBAUTHN_ORIGINS is a comma-separated list of
 * exact page origins allowed to use them.
 */
function config() {
  const rpID = process.env.WEBAUTHN_RP_ID?.trim();
  const origins = (process.env.WEBAUTHN_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (!rpID || origins.length === 0) {
    throw new ServiceUnavailableException('Passkey sign-in is not configured.');
  }
  return { rpID, origins, rpName: 'MyAmbii' };
}

@Injectable()
export class PasskeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  // ---- Challenges ---------------------------------------------------------

  private async saveChallenge(challenge: string, userId: string | null): Promise<string> {
    await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const row = await this.prisma.webAuthnChallenge.create({
      data: { challenge, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    return row.id;
  }

  /** Single-use: deleted on first read, so a captured response can't be replayed. */
  private async consumeChallenge(id: string) {
    const row = await this.prisma.webAuthnChallenge.delete({ where: { id } }).catch(() => null);
    if (!row || row.expiresAt < new Date()) {
      throw new BadRequestException('This passkey request expired. Please try again.');
    }
    return row;
  }

  // ---- Registration (signed-in user adds a passkey) -----------------------

  async registrationOptions(userId: string) {
    const { rpID, rpName } = config();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { passkeys: true } });
    if (!user || user.deletedAt) throw new NotFoundException('Account not found.');
    if (user.passkeys.length >= MAX_PASSKEYS_PER_USER) {
      throw new BadRequestException(`You can save up to ${MAX_PASSKEYS_PER_USER} passkeys. Remove one first.`);
    }

    const label = user.email ?? user.phone ?? 'MyAmbii account';
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: isoUint8Array.fromUTF8String(user.id),
      userName: label,
      userDisplayName: label,
      attestationType: 'none',
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.id,
        transports: p.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });

    const challengeId = await this.saveChallenge(options.challenge, user.id);
    return { options, challengeId };
  }

  async verifyRegistration(userId: string, challengeId: string, response: RegistrationResponseJSON, name?: string) {
    const { rpID, origins } = config();
    const challenge = await this.consumeChallenge(challengeId);
    if (challenge.userId !== userId) throw new BadRequestException('This passkey request expired. Please try again.');

    let result;
    try {
      result = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
      });
    } catch (e) {
      throw new BadRequestException(`Passkey could not be verified: ${(e as Error).message}`);
    }
    if (!result.verified || !result.registrationInfo) {
      throw new BadRequestException('Passkey could not be verified.');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    const passkey = await this.prisma.passkey.create({
      data: {
        id: credential.id,
        userId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: name?.trim() || null,
      },
    });
    return this.toPublic(passkey);
  }

  // ---- Management ---------------------------------------------------------

  async list(userId: string) {
    const rows = await this.prisma.passkey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((p) => this.toPublic(p));
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.passkey.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException('Passkey not found.');
    return { ok: true };
  }

  // ---- Sign-in (anyone, no email typed — the passkey identifies the user) --

  async loginOptions() {
    const { rpID } = config();
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    const challengeId = await this.saveChallenge(options.challenge, null);
    return { options, challengeId };
  }

  async verifyLogin(challengeId: string, response: AuthenticationResponseJSON, portal: 'candidate' | 'employer' = 'candidate') {
    const { rpID, origins } = config();
    const challenge = await this.consumeChallenge(challengeId);

    const passkey = await this.prisma.passkey.findUnique({ where: { id: response.id }, include: { user: true } });
    if (!passkey || passkey.user.deletedAt) {
      throw new UnauthorizedException(
        "This passkey isn't registered with MyAmbii. Sign in another way, then add it from your account settings.",
      );
    }

    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origins,
        expectedRPID: rpID,
        credential: {
          id: passkey.id,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports as AuthenticatorTransport[],
        },
      });
    } catch {
      throw new UnauthorizedException('Passkey sign-in failed. Please try again.');
    }
    if (!result.verified) throw new UnauthorizedException('Passkey sign-in failed. Please try again.');

    // Portal rules — checked only after the signature verified, so they never
    // reveal anything about an account to someone who doesn't hold its key.
    if (portal === 'employer') {
      // Same rule as AuthService.loginEmployerWithIdentity: employer role AND an OrgMember row.
      const membership = await this.prisma.orgMember.findUnique({ where: { userId: passkey.userId } });
      if (!EMPLOYER_ROLES.includes(passkey.user.role) || !membership) {
        throw new ForbiddenException("This account isn't registered as an employer. Contact your administrator.");
      }
    } else if (EMPLOYER_ROLES.includes(passkey.user.role)) {
      // Same cross-portal rule as verifyCandidateEmailOtp.
      throw new BadRequestException('This passkey belongs to an employer account. Log in from the employer portal.');
    }

    await this.prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });

    return this.auth.issueTokensForPasskey(passkey.user);
  }

  private toPublic(p: Passkey) {
    return { id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, backedUp: p.backedUp };
  }
}
