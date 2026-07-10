/** What we ask the client (web/mobile) to hand us after they run the provider's own auth-code / PKCE flow. */
export interface OAuthCodeExchange {
  code: string;
  redirectUri: string;
  /** PKCE code_verifier — required for the mobile native-SDK flow, unused for confidential web clients. */
  codeVerifier?: string;
}

/**
 * Normalized shape both providers reduce to. `providerId` is always the
 * provider's stable subject id — Google's `sub`, GitHub's numeric user id —
 * never the email. `emailVerified` reflects what the provider itself
 * attests (Google's `email_verified`, GitHub's primary+verified email),
 * and is the only signal AuthService is allowed to auto-link on.
 */
export interface ExternalProfile {
  providerId: string;
  email: string | null;
  emailVerified: boolean;
}
