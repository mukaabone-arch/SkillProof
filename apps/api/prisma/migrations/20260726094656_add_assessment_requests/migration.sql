-- CreateEnum
CREATE TYPE "AssessmentRequestStatus" AS ENUM ('PAID_PENDING_START', 'STARTED', 'COMPLETED', 'EXPIRED_REFUNDED', 'REFUND_FAILED', 'ALREADY_BADGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ASSESSMENT_REQUEST_INVITE';
ALTER TYPE "NotificationType" ADD VALUE 'ASSESSMENT_REQUEST_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'ASSESSMENT_REQUEST_RESULT';

-- CreateTable
CREATE TABLE "AssessmentRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL,
    "status" "AssessmentRequestStatus" NOT NULL DEFAULT 'PAID_PENDING_START',
    "amount" INTEGER,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpayRefundId" TEXT,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "attemptId" TEXT,
    "sessionId" TEXT,
    "badgeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequest_attemptId_key" ON "AssessmentRequest"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequest_sessionId_key" ON "AssessmentRequest"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequest_badgeId_key" ON "AssessmentRequest"("badgeId");

-- CreateIndex
CREATE INDEX "AssessmentRequest_orgId_idx" ON "AssessmentRequest"("orgId");

-- CreateIndex
CREATE INDEX "AssessmentRequest_candidateId_idx" ON "AssessmentRequest"("candidateId");

-- CreateIndex
CREATE INDEX "AssessmentRequest_status_expiresAt_idx" ON "AssessmentRequest"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
