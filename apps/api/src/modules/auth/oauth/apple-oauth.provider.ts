import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createPrivateKey, createPublicKey, JsonWebKey, sign as cryptoSign, verify as cryptoVerify } from 'crypto';
import { ExternalProfile } from './oauth.types';

const APPLE_ISSUER = 'https://appleid.apple.com';
const KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;
/** Apple rotates its signing keys rarely; an unknown `kid` forces one refetch regardless. */
const KEYS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;
const HTTP_TIMEOUT_MS = 8000;

const INVALID = 'Apple sign-in could not be verified. Please try again.';

export interface AppleSignInResult {
  profile: ExternalProfile;
  /** Needed later to revoke the grant on account deletion (App Store 5.1.1(v)). Null if the code exchange failed — sign-in still succeeds. */
  refreshToken: string | null;
}

interface AppleIdTokenClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  sub: string;
  email?: string;
  /** Apple sends these as booleans OR the strings "true"/"false". */
  email_verified?: boolean | string;
  is_private_email?: boolean | string;
}

function b64urlJson<T>(part: string): T {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
}

function isTrue(v: boolean | string | undefined): boolean {
  return v === true || v === 'true';
}

/**
 * Sign in with Apple, native-app flow. The iOS app gets an `identityToken`
 * (a JWT signed by Apple) plus a one-time `authorizationCode` from the system
 * sheet and posts both to /auth/apple.
 *
 * - The identity token is verified here, locally, against Apple's published
 *   keys (RS256), issuer, audience (= the app's bundle ID, APPLE_CLIENT_ID)
 *   and expiry. Done with Node's crypto directly — no JWT library dependency.
 * - The authorization code is exchanged for a refresh token, kept only so
 *   account deletion can revoke the Apple grant (Apple requires that). The
 *   client secret for that call is a short-lived ES256 JWT signed with our
 *   .p8 key (APPLE_SIGNIN_KEY, APPLE_KEY_ID, APPLE_TEAM_ID).
 *
 * "Hide my email" relay addresses (@privaterelay.appleid.com) arrive with
 * email_verified=true and are treated like any verified email.
 */
@Injectable()
export class AppleOAuthProvider {
  private readonly logger = new Logger(AppleOAuthProvider.name);
  private keyCache: { fetchedAt: number; byKid: Map<string, JsonWebKey> } | null = null;

  private config() {
    return {
      clientId: process.env.APPLE_CLIENT_ID?.trim() ?? '',
      teamId: process.env.APPLE_TEAM_ID?.trim() ?? '',
      keyId: process.env.APPLE_KEY_ID?.trim() ?? '',
      // Secrets Manager keeps real newlines; tolerate a "\n"-escaped value too.
      privateKey: (process.env.APPLE_SIGNIN_KEY ?? '').replace(/\\n/g, '\n').trim(),
    };
  }

  async signIn(identityToken: string, authorizationCode?: string): Promise<AppleSignInResult> {
    const { clientId } = this.config();
    if (!clientId) throw new BadRequestException('Sign in with Apple is not configured');

    const claims = await this.verifyIdentityToken(identityToken, clientId);

    let refreshToken: string | null = null;
    if (authorizationCode) {
      try {
        refreshToken = await this.exchangeCode(authorizationCode);
      } catch (err) {
        // Don't fail the sign-in over this — the user is already verified by
        // the identity token. Deletion just can't revoke this one grant.
        this.logger.warn(`Apple code exchange failed: ${(err as Error).message}`);
      }
    }

    return {
      profile: {
        providerId: claims.sub,
        email: claims.email ?? null,
        emailVerified: !!claims.email && isTrue(claims.email_verified),
      },
      refreshToken,
    };
  }

  /** Best-effort: never throws, so account deletion is never blocked by Apple being unreachable. */
  async revoke(refreshToken: string): Promise<boolean> {
    try {
      const { clientId } = this.config();
      const res = await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: this.clientSecret(),
          token: refreshToken,
          token_type_hint: 'refresh_token',
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Apple token revoke returned ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Apple token revoke failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ---- internals ----------------------------------------------------------

  async verifyIdentityToken(token: string, clientId: string): Promise<AppleIdTokenClaims> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException(INVALID);
    const [h, p, s] = parts;

    let header: { alg?: string; kid?: string };
    let claims: AppleIdTokenClaims;
    try {
      header = b64urlJson(h);
      claims = b64urlJson(p);
    } catch {
      throw new UnauthorizedException(INVALID);
    }
    if (header.alg !== 'RS256' || !header.kid) throw new UnauthorizedException(INVALID);

    const jwk = await this.keyFor(header.kid);
    if (!jwk) throw new UnauthorizedException(INVALID);

    const ok = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(s, 'base64url'),
    );
    if (!ok) throw new UnauthorizedException(INVALID);

    const now = Math.floor(Date.now() / 1000);
    const audOk = Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId;
    if (claims.iss !== APPLE_ISSUER || !audOk || !claims.sub) throw new UnauthorizedException(INVALID);
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < now) {
      throw new UnauthorizedException('Apple sign-in expired. Please try again.');
    }
    return claims;
  }

  private async keyFor(kid: string): Promise<JsonWebKey | undefined> {
    const fresh = this.keyCache && Date.now() - this.keyCache.fetchedAt < KEYS_TTL_MS;
    if (!fresh || !this.keyCache!.byKid.has(kid)) await this.fetchKeys();
    return this.keyCache?.byKid.get(kid);
  }

  private async fetchKeys(): Promise<void> {
    const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    if (!res.ok) throw new UnauthorizedException(INVALID);
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const byKid = new Map<string, JsonWebKey>();
    for (const k of body.keys ?? []) if (k.kid) byKid.set(k.kid, k);
    this.keyCache = { fetchedAt: Date.now(), byKid };
  }

  private async exchangeCode(code: string): Promise<string | null> {
    const { clientId } = this.config();
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: this.clientSecret(),
        code,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body.refresh_token ?? null;
  }

  /** Short-lived (5 min) ES256 client secret, per Apple's spec. */
  clientSecret(): string {
    const { clientId, teamId, keyId, privateKey } = this.config();
    if (!clientId || !teamId || !keyId || !privateKey) {
      throw new Error('Apple key not configured (APPLE_CLIENT_ID/APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_SIGNIN_KEY)');
    }
    const iat = Math.floor(Date.now() / 1000);
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${enc({ alg: 'ES256', kid: keyId })}.${enc({ iss: teamId, iat, exp: iat + 300, aud: APPLE_ISSUER, sub: clientId })}`;
    const sig = cryptoSign('sha256', Buffer.from(data), { key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
    return `${data}.${sig.toString('base64url')}`;
  }
}
