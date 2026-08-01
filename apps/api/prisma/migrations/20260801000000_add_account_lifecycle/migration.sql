-- CreateEnum
CREATE TYPE "AccountActionType" AS ENUM ('DEACTIVATED', 'REACTIVATED', 'DELETED');

-- CreateEnum
CREATE TYPE "AccountActionReason" AS ENUM ('FOUND_JOB_SKILLPROOF', 'FOUND_JOB_ELSEWHERE', 'NOT_FINDING_ROLES', 'TOO_MANY_EMAILS', 'PRIVACY_CONCERNS', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_CANDIDATE_UNAVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_DEACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_DELETED';

-- AlterEnum
ALTER TYPE "ShortlistStage" ADD VALUE 'CANDIDATE_UNAVAILABLE';

-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN "deactivatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ShortlistEntry" ADD COLUMN "preUnavailableStage" "ShortlistStage";

-- CreateTable
CREATE TABLE "AccountAction" (
    "id" TEXT NOT NULL,
    "candidateProfileId" TEXT NOT NULL,
    "type" "AccountActionType" NOT NULL,
    "reasonCategory" "AccountActionReason",
    "reasonText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountAction_candidateProfileId_idx" ON "AccountAction"("candidateProfileId");

-- AddForeignKey
ALTER TABLE "AccountAction" ADD CONSTRAINT "AccountAction_candidateProfileId_fkey" FOREIGN KEY ("candidateProfileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
