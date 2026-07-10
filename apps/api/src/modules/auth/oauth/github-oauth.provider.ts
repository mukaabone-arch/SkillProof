import { BadRequestException, Injectable } from '@nestjs/common';
import { ExternalProfile, OAuthCodeExchange } from './oauth.types';

interface GithubTokenResponse {
  access_token?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
}

interface GithubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * Authorization-code exchange against GitHub's OAuth endpoints. GitHub's
 * /user endpoint often omits `email` (depends on the user's public-email
 * setting), so the verified/primary flag can only come from /user/emails —
 * that's why this needs the user:email scope, not just read:user.
 */
@Injectable()
export class GithubOAuthProvider {
  async exchange({ code, redirectUri, codeVerifier }: OAuthCodeExchange): Promise<ExternalProfile> {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new BadRequestException('GitHub sign-in is not configured');
    }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      }),
    });
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as GithubTokenResponse;
    if (!tokenRes.ok || !tokenBody.access_token) {
      throw new BadRequestException(
        tokenBody.error_description ?? 'Invalid or expired GitHub authorization code',
      );
    }

    const headers = {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'User-Agent': 'skillproof-api',
      Accept: 'application/vnd.github+json',
    };

    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new BadRequestException('Failed to fetch GitHub profile');
    const user = (await userRes.json()) as GithubUserResponse;

    const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
    const emails: GithubEmailResponse[] = emailsRes.ok ? await emailsRes.json() : [];
    const primaryEmail = emails.find((e) => e.primary) ?? null;

    return {
      providerId: String(user.id),
      email: primaryEmail?.email ?? null,
      emailVerified: !!primaryEmail?.verified,
    };
  }
}
