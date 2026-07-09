-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('APPROVED', 'INVALIDATED');

-- AlterEnum
ALTER TYPE "IntegrityStatus" ADD VALUE 'INVALIDATED';

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "questionsPerAttempt" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewOutcome" "ReviewOutcome",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
