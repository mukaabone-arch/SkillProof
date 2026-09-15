-- CreateTable
CREATE TABLE "AssessmentBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "triggerAttemptIds" TEXT[],
    "reason" TEXT NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedByUserId" TEXT,
    "liftedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentBlock_userId_expiresAt_idx" ON "AssessmentBlock"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "AssessmentBlock" ADD CONSTRAINT "AssessmentBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBlock" ADD CONSTRAINT "AssessmentBlock_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentBlock" ADD CONSTRAINT "AssessmentBlock_liftedByUserId_fkey" FOREIGN KEY ("liftedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
