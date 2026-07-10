import { BadRequestException, Injectable } from '@nestjs/common';
import { ExternalProfile, OAuthCodeExchange } from './oauth.types';

interface GoogleTokenResponse {
  access_token?: string;
  error_description?: string;
}

interface GoogleUserinfoResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

/**
 * Authorization-code exchange against Google's OAuth endpoints. We call the
 * userinfo endpoint with the freshly-issued access token rather than
 * decoding the id_token ourselves — one less place to get JWT signature
 * verification wrong, and the access token is already proof of a live,
 * server-to-server-verified grant.
 */
@Injectable()
export class GoogleOAuthProvider {
  async exchange({ code, redirectUri, codeVerifier }: OAuthCodeExchange): Promise<ExternalProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Google sign-in is not configured');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
    });
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as GoogleTokenResponse;
    if (!tokenRes.ok || !tokenBody.access_token) {
      throw new BadRequestException(
        tokenBody.error_description ?? 'Invalid or expired Google authorization code',
      );
    }

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!profileRes.ok) {
      throw new BadRequestException('Failed to fetch Google profile');
    }
    const profile = (await profileRes.json()) as GoogleUserinfoResponse;

    return {
      providerId: profile.sub,
      email: profile.email ?? null,
      emailVerified: !!profile.email_verified,
    };
  }
}
