-- In-app reporting of AI-generated content (Google Play AI-Generated Content
-- policy): a candidate can flag an AI assessor message, live feedback, or an
-- AI-written result reason as offensive/inappropriate. See AiContentReport.
CREATE TYPE "AiContentTarget" AS ENUM ('ASSESSOR_TURN', 'LIVE_FEEDBACK', 'RESULT_REASON');
CREATE TYPE "AiContentReportReason" AS ENUM ('OFFENSIVE', 'HATEFUL', 'SEXUAL', 'DANGEROUS', 'MISLEADING', 'OTHER');
CREATE TYPE "AiContentReportStatus" AS ENUM ('OPEN', 'REVIEWED');

CREATE TABLE "AiContentReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "targetType" "AiContentTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "AiContentReportReason" NOT NULL,
    "note" TEXT,
    "contentSnapshot" TEXT NOT NULL,
    "status" "AiContentReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiContentReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiContentReport_userId_targetType_targetId_key" ON "AiContentReport"("userId", "targetType", "targetId");
CREATE INDEX "AiContentReport_status_createdAt_idx" ON "AiContentReport"("status", "createdAt");
CREATE INDEX "AiContentReport_userId_createdAt_idx" ON "AiContentReport"("userId", "createdAt");
