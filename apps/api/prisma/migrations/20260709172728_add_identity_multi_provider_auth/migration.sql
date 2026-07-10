-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('PHONE', 'GOOGLE', 'GITHUB');

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "providerId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Identity_userId_idx" ON "Identity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Identity_provider_providerId_key" ON "Identity"("provider", "providerId");

-- AddForeignKey
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DataMigration: backfill existing phone-auth users into Identity rows.
-- providerId is the phone number itself (the OTP flow's stable identifier);
-- email/emailVerified are left null/false because the PHONE provider never
-- reports an email — a user's User.email (if any) was self-reported, not
-- provider-verified, so it must not be copied here as if it were.
INSERT INTO "Identity" ("id", "userId", "provider", "providerId", "email", "emailVerified", "createdAt")
SELECT gen_random_uuid()::text, "id", 'PHONE', "phone", NULL, false, "createdAt"
FROM "User"
WHERE "phone" IS NOT NULL;
