-- CreateEnum
CREATE TYPE "CertIssuer" AS ENUM ('CREDLY', 'COURSERA', 'LINKEDIN_LEARNING', 'PMI', 'PEOPLECERT', 'AWS', 'MICROSOFT', 'GOOGLE', 'SCRUM_ALLIANCE', 'UDEMY', 'EDX', 'NPTEL', 'OTHER');

-- CreateEnum
CREATE TYPE "CertVerificationStatus" AS ENUM ('VERIFIED', 'LINK_PROVIDED', 'SELF_REPORTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CertVerificationSource" AS ENUM ('CREDLY', 'URL', 'MANUAL_UPLOAD');

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" "CertIssuer" NOT NULL,
    "issuerOther" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "credentialId" TEXT,
    "credentialUrl" TEXT,
    "fileUrl" TEXT,
    "verificationStatus" "CertVerificationStatus" NOT NULL DEFAULT 'SELF_REPORTED',
    "verificationSource" "CertVerificationSource" NOT NULL,
    "skillTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Certification_profileId_idx" ON "Certification"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "Certification_profileId_credentialUrl_key" ON "Certification"("profileId", "credentialUrl");

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every already-VERIFIED ExternalCredential (the Credly-only flow
-- this feature supersedes for new writes — see Certification's doc comment
-- in schema.prisma) becomes a VERIFIED/CREDLY Certification row, so a
-- candidate's existing Credly certs show up immediately in the new unified
-- list instead of only the old one. PENDING/FAILED ExternalCredential rows
-- are deliberately left behind — they never represented usable proof (the
-- apply-gate and employer view already ignore them), and ExternalCredential
-- itself is untouched by this migration, so nothing existing breaks.
--
-- issueDate is NOT NULL on Certification but ExternalCredential.issuedAt is
-- nullable (Credly's assertion doesn't always carry issuedOn) — COALESCE to
-- createdAt (when the candidate added it) rather than leaving a gap.
-- credentialId <- externalId (Credly's own badge UUID).
INSERT INTO "Certification" (
    "id", "profileId", "name", "issuer", "issueDate", "expiryDate",
    "credentialId", "credentialUrl", "verificationStatus", "verificationSource",
    "skillTags", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "profileId",
    COALESCE("name", 'Credly credential'),
    'CREDLY'::"CertIssuer",
    COALESCE("issuedAt", "createdAt"),
    "expiresAt",
    "externalId",
    "credentialUrl",
    'VERIFIED'::"CertVerificationStatus",
    'CREDLY'::"CertVerificationSource",
    ARRAY[]::TEXT[],
    "createdAt",
    "createdAt"
FROM "ExternalCredential"
WHERE "verificationState" = 'VERIFIED';
