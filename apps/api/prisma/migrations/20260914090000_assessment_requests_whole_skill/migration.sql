-- AlterTable
ALTER TABLE "AssessmentRequest" ALTER COLUMN "level" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AssessmentRequestLevel" (
    "id" TEXT NOT NULL,
    "assessmentRequestId" TEXT NOT NULL,
    "level" "SkillLevel" NOT NULL,
    "attemptId" TEXT,
    "sessionId" TEXT,
    "badgeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentRequestLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequestLevel_attemptId_key" ON "AssessmentRequestLevel"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequestLevel_sessionId_key" ON "AssessmentRequestLevel"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequestLevel_badgeId_key" ON "AssessmentRequestLevel"("badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequestLevel_assessmentRequestId_level_key" ON "AssessmentRequestLevel"("assessmentRequestId", "level");

-- CreateIndex
CREATE INDEX "AssessmentRequest_level_status_startedAt_idx" ON "AssessmentRequest"("level", "status", "startedAt");

-- AddForeignKey
ALTER TABLE "AssessmentRequestLevel" ADD CONSTRAINT "AssessmentRequestLevel_assessmentRequestId_fkey" FOREIGN KEY ("assessmentRequestId") REFERENCES "AssessmentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequestLevel" ADD CONSTRAINT "AssessmentRequestLevel_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequestLevel" ADD CONSTRAINT "AssessmentRequestLevel_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequestLevel" ADD CONSTRAINT "AssessmentRequestLevel_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "Badge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
