-- Sign in with Apple: new identity provider + the refresh token needed to
-- revoke the Apple grant when the account is deleted (App Store 5.1.1(v)).
ALTER TYPE "IdentityProvider" ADD VALUE IF NOT EXISTS 'APPLE';
ALTER TABLE "Identity" ADD COLUMN "providerRefreshToken" TEXT;
