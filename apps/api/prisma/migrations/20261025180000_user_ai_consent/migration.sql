-- One-time AI-processing consent (App Store guideline 5.1.2(i)) — see User.aiConsentAt.
ALTER TABLE "User" ADD COLUMN "aiConsentAt" TIMESTAMP(3);
