-- AI sourcing and outreach: candidate contact preference, campaigns, messages and their audit trail.

-- CreateEnum
CREATE TYPE "RecruiterContactPreference" AS ENUM ('ANYONE', 'VERIFIED_MATCHES', 'OFF');
CREATE TYPE "OutreachCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'SKIPPED', 'SENT', 'INTERESTED', 'NOT_NOW', 'NOT_INTERESTED', 'STOPPED');
CREATE TYPE "OutreachEventType" AS ENUM ('DRAFTED', 'EDITED', 'SENT', 'FOLLOW_UP', 'REPLIED', 'STOPPED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'OUTREACH_MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'OUTREACH_FOLLOW_UP';
ALTER TYPE "NotificationType" ADD VALUE 'OUTREACH_REPLY';

-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN "recruiterContact" "RecruiterContactPreference" NOT NULL DEFAULT 'ANYONE';
ALTER TABLE "CandidateProfile" ADD COLUMN "outreachWeeklyLimit" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "OutreachCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "status" "OutreachCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "followUpDays" INTEGER[] DEFAULT ARRAY[3, 7]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "matchReason" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "followUpsSent" INTEGER NOT NULL DEFAULT 0,
    "nextFollowUpAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "candidateNote" TEXT,
    "shortlistEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachEvent" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "OutreachEventType" NOT NULL,
    "actorUserId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachCampaign_orgId_createdAt_idx" ON "OutreachCampaign"("orgId", "createdAt");
CREATE INDEX "OutreachCampaign_jobId_idx" ON "OutreachCampaign"("jobId");
CREATE UNIQUE INDEX "OutreachMessage_campaignId_candidateId_key" ON "OutreachMessage"("campaignId", "candidateId");
CREATE INDEX "OutreachMessage_candidateId_sentAt_idx" ON "OutreachMessage"("candidateId", "sentAt");
CREATE INDEX "OutreachMessage_orgId_candidateId_idx" ON "OutreachMessage"("orgId", "candidateId");
CREATE INDEX "OutreachMessage_sentByUserId_sentAt_idx" ON "OutreachMessage"("sentByUserId", "sentAt");
CREATE INDEX "OutreachMessage_status_nextFollowUpAt_idx" ON "OutreachMessage"("status", "nextFollowUpAt");
CREATE INDEX "OutreachEvent_messageId_createdAt_idx" ON "OutreachEvent"("messageId", "createdAt");

-- AddForeignKey
ALTER TABLE "OutreachCampaign" ADD CONSTRAINT "OutreachCampaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutreachCampaign" ADD CONSTRAINT "OutreachCampaign_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutreachCampaign" ADD CONSTRAINT "OutreachCampaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "OutreachCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutreachEvent" ADD CONSTRAINT "OutreachEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutreachMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
