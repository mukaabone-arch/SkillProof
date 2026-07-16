-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('DEMONSTRATED', 'PARTIAL', 'NOT_EVIDENCED', 'ABSTAIN');

-- AlterEnum
ALTER TYPE "AssessmentSessionStatus" ADD VALUE 'AWAITING_REVIEW';

-- AlterTable
ALTER TABLE "AssessmentSession" ADD COLUMN     "rubricVersion" TEXT NOT NULL DEFAULT 'rag-systems-l2-r2',
ADD COLUMN     "scoredAt" TIMESTAMP(3),
ADD COLUMN     "scoringError" TEXT;

-- CreateTable
CREATE TABLE "ClaimVerdict" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "claimId" "RagL2Claim" NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "bandBoundary" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "modelVerdict" "Verdict" NOT NULL,
    "modelBandBoundary" BOOLEAN NOT NULL,
    "modelReason" TEXT NOT NULL,
    "modelConfidence" DOUBLE PRECISION NOT NULL,
    "spans" JSONB NOT NULL,
    "reviewerVerdict" "Verdict",
    "reviewerId" TEXT,
    "reviewerNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimVerdict_sessionId_idx" ON "ClaimVerdict"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimVerdict_sessionId_claimId_key" ON "ClaimVerdict"("sessionId", "claimId");

-- AddForeignKey
ALTER TABLE "ClaimVerdict" ADD CONSTRAINT "ClaimVerdict_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimVerdict" ADD CONSTRAINT "ClaimVerdict_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
