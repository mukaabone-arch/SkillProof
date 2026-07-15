-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssessmentSessionStatus" ADD VALUE 'ISSUED';
ALTER TYPE "AssessmentSessionStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "Verdict" ADD VALUE 'INSUFFICIENT_PROBING';

-- DropForeignKey
ALTER TABLE "Badge" DROP CONSTRAINT "Badge_attemptId_fkey";

-- AlterTable
ALTER TABLE "AssessmentSession" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedByUserId" TEXT,
ADD COLUMN     "decisionNote" TEXT;

-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "sessionId" TEXT,
ALTER COLUMN "attemptId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Badge_sessionId_key" ON "Badge"("sessionId");

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSession" ADD CONSTRAINT "AssessmentSession_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

