-- CreateTable
CREATE TABLE "LiveClaimFeedback" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "claimId" "RagL2Claim" NOT NULL,
    "verdictLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "strengths" JSONB NOT NULL,
    "gaps" JSONB NOT NULL,
    "helpfulVote" BOOLEAN,
    "votedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveClaimFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveClaimFeedback_sessionId_idx" ON "LiveClaimFeedback"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveClaimFeedback_sessionId_claimId_key" ON "LiveClaimFeedback"("sessionId", "claimId");

-- AddForeignKey
ALTER TABLE "LiveClaimFeedback" ADD CONSTRAINT "LiveClaimFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
