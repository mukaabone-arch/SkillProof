-- CreateEnum
CREATE TYPE "CredentialIssuer" AS ENUM ('CREDLY', 'AWS', 'GOOGLE', 'AZURE', 'NVIDIA', 'DATABRICKS', 'IBM', 'OTHER');

-- CreateEnum
CREATE TYPE "CredentialVerificationState" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "ExternalCredential" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "issuer" "CredentialIssuer" NOT NULL DEFAULT 'OTHER',
    "name" TEXT,
    "credentialUrl" TEXT NOT NULL,
    "verificationState" "CredentialVerificationState" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalCredential_profileId_idx" ON "ExternalCredential"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalCredential_profileId_credentialUrl_key" ON "ExternalCredential"("profileId", "credentialUrl");

-- AddForeignKey
ALTER TABLE "ExternalCredential" ADD CONSTRAINT "ExternalCredential_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
