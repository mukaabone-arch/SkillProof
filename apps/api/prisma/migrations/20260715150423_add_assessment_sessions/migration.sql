-- CreateEnum
CREATE TYPE "AssessmentSessionStatus" AS ENUM ('IN_PROGRESS', 'AWAITING_SCORING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RagL2Claim" AS ENUM ('CHUNKING', 'DIAGNOSIS', 'RERANKING', 'CORPUS_CHANGE', 'EVALUATION', 'COST');

-- CreateEnum
CREATE TYPE "ProbeRung" AS ENUM ('OPENING', 'FOLLOWUP', 'CONSTRAINT');

-- CreateEnum
CREATE TYPE "SessionTurnRole" AS ENUM ('CANDIDATE', 'ASSESSOR');

-- CreateTable
CREATE TABLE "AssessmentSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AssessmentSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "pinnedBrief" TEXT NOT NULL,
    "ladderState" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "SessionTurnRole" NOT NULL,
    "content" TEXT NOT NULL,
    "claimId" "RagL2Claim",
    "probeRung" "ProbeRung",
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionInterruption" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumedAt" TIMESTAMP(3),
    "fragmentTurnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionInterruption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentSession_userId_idx" ON "AssessmentSession"("userId");

-- CreateIndex
CREATE INDEX "SessionTurn_sessionId_idx" ON "SessionTurn"("sessionId");

-- CreateIndex
CREATE INDEX "SessionInterruption_sessionId_idx" ON "SessionInterruption"("sessionId");

-- AddForeignKey
ALTER TABLE "AssessmentSession" ADD CONSTRAINT "AssessmentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionTurn" ADD CONSTRAINT "SessionTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionInterruption" ADD CONSTRAINT "SessionInterruption_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
