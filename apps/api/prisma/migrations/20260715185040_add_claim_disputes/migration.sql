-- AlterEnum
ALTER TYPE "AssessmentSessionStatus" ADD VALUE 'DISPUTED';

-- CreateTable
CREATE TABLE "ClaimDispute" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "claimId" "RagL2Claim" NOT NULL,
    "candidateId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,

    CONSTRAINT "ClaimDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimDispute_sessionId_idx" ON "ClaimDispute"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimDispute_sessionId_claimId_key" ON "ClaimDispute"("sessionId", "claimId");

-- AddForeignKey
ALTER TABLE "ClaimDispute" ADD CONSTRAINT "ClaimDispute_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

