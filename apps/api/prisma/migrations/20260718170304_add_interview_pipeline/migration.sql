/*
  Warnings:

  - Added the required column `updatedAt` to the `ShortlistEntry` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CandidateOfferResponse" AS ENUM ('ACCEPTED', 'DECLINED', 'NEGOTIATING');

-- CreateEnum
CREATE TYPE "InterviewRoundStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'PASSED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_INVITE';
ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_INVITE_RESPONSE';
ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_ROUND_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_OFFER';
ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_OFFER_RESPONSE';
ALTER TYPE "NotificationType" ADD VALUE 'PIPELINE_REJECTED';

-- AlterTable
ALTER TABLE "ShortlistEntry" ADD COLUMN     "candidateResponse" "CandidateOfferResponse",
ADD COLUMN     "inviteMessage" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "InterviewRound" (
    "id" TEXT NOT NULL,
    "shortlistEntryId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "status" "InterviewRoundStatus" NOT NULL DEFAULT 'SCHEDULED',
    "channel" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewRound_shortlistEntryId_idx" ON "InterviewRound"("shortlistEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRound_shortlistEntryId_roundNumber_key" ON "InterviewRound"("shortlistEntryId", "roundNumber");

-- CreateIndex
CREATE INDEX "ShortlistEntry_candidateId_idx" ON "ShortlistEntry"("candidateId");

-- AddForeignKey
ALTER TABLE "InterviewRound" ADD CONSTRAINT "InterviewRound_shortlistEntryId_fkey" FOREIGN KEY ("shortlistEntryId") REFERENCES "ShortlistEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
