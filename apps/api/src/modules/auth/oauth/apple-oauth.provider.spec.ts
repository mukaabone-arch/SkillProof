import { UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, KeyObject } from 'crypto';
import { AppleOAuthProvider } from './apple-oauth.provider';

const CLIENT_ID = 'com.mukaab.myambii';
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KID = 'test-kid';

function b64(o: object) {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}
function appleToken(claims: Record<string, unknown>, key: KeyObject = rsa.privateKey, kid = KID) {
  const data = `${b64({ alg: 'RS256', kid })}.${b64(claims)}`;
  return `${data}.${cryptoSign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
}
const now = () => Math.floor(Date.now() / 1000);
const goodClaims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://appleid.apple.com', aud: CLIENT_ID, iat: now(), exp: now() + 600,
  sub: 'apple-user-1', email: 'a@example.com', email_verified: 'true', ...over,
});

function json(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response);
}

describe('AppleOAuthProvider', () => {
  let fetchMock: jest.SpyInstance;
  const calls: { url: string; body?: URLSearchParams }[] = [];

  beforeEach(() => {
    process.env.APPLE_CLIENT_ID = CLIENT_ID;
    process.env.APPLE_TEAM_ID = 'K9JT4P7WU5';
    process.env.APPLE_KEY_ID = 'ABC123XYZ9';
    process.env.APPLE_SIGNIN_KEY = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    calls.length = 0;
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as URLSearchParams });
      if (url.endsWith('/auth/keys')) {
        return json({ keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] });
      }
      if (url.endsWith('/auth/token')) return json({ refresh_token: 'r-123' });
      if (url.endsWith('/auth/revoke')) return json({});
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch);
  });
  afterEach(() => fetchMock.mockRestore());

  it('verifies a valid token and exchanges the code for a refresh token', async () => {
    const r = await new AppleOAuthProvider().signIn(appleToken(goodClaims()), 'code-1');
    expect(r.profile).toEqual({ providerId: 'apple-user-1', email: 'a@example.com', emailVerified: true });
    expect(r.refreshToken).toBe('r-123');
  });

  it('treats a private-relay email as verified', async () => {
    const r = await new AppleOAuthProvider().signIn(
      appleToken(goodClaims({ email: 'x1y2@privaterelay.appleid.com', email_verified: true, is_private_email: 'true' })),
    );
    expect(r.profile.emailVerified).toBe(true);
    expect(r.refreshToken).toBeNull();
  });

  it('marks an unverified email as unverified', async () => {
    const r = await new AppleOAuthProvider().signIn(appleToken(goodClaims({ email_verified: 'false' })));
    expect(r.profile.emailVerified).toBe(false);
  });

  it('rejects a token for another app (wrong audience)', async () => {
    await expect(new AppleOAuthProvider().signIn(appleToken(goodClaims({ aud: 'com.other.app' })))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    await expect(new AppleOAuthProvider().signIn(appleToken(goodClaims({ exp: now() - 3600 })))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a wrong issuer', async () => {
    await expect(new AppleOAuthProvider().signIn(appleToken(goodClaims({ iss: 'https://evil.example' })))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed by a different key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    await expect(new AppleOAuthProvider().signIn(appleToken(goodClaims(), other.privateKey))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed token', async () => {
    await expect(new AppleOAuthProvider().signIn('not.a-jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('still signs in when the code exchange fails', async () => {
    fetchMock.mockImplementation(((url: string) =>
      url.endsWith('/auth/keys')
        ? json({ keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: KID }] })
        : json({ error: 'invalid_grant' }, false, 400)) as unknown as typeof fetch);
    const r = await new AppleOAuthProvider().signIn(appleToken(goodClaims()), 'stale-code');
    expect(r.refreshToken).toBeNull();
    expect(r.profile.providerId).toBe('apple-user-1');
  });

  it('builds a client secret Apple can verify (ES256, our team/key/bundle)', () => {
    const secret = new AppleOAuthProvider().clientSecret();
    const [h, p, s] = secret.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABC123XYZ9' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims).toMatchObject({ iss: 'K9JT4P7WU5', sub: CLIENT_ID, aud: 'https://appleid.apple.com' });
    expect(claims.exp - claims.iat).toBe(300);
    const ok = cryptoVerify('sha256', Buffer.from(`${h}.${p}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });

  it('revokes a refresh token and never throws on failure', async () => {
    const provider = new AppleOAuthProvider();
    await expect(provider.revoke('r-123')).resolves.toBe(true);
    const revoke = calls.find((c) => c.url.endsWith('/auth/revoke'))!;
    expect(revoke.body!.get('token')).toBe('r-123');
    expect(revoke.body!.get('token_type_hint')).toBe('refresh_token');

    fetchMock.mockImplementation((() => Promise.reject(new Error('network down'))) as unknown as typeof fetch);
    await expect(provider.revoke('r-123')).resolves.toBe(false);
  });
});
