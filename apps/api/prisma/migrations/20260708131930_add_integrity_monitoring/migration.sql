-- CreateEnum
CREATE TYPE "IntegrityEventType" AS ENUM ('TAB_BLUR', 'TAB_FOCUS', 'PASTE_ATTEMPT', 'COPY_ATTEMPT', 'FULLSCREEN_EXIT', 'RAPID_ANSWER', 'RIGHT_CLICK');

-- CreateEnum
CREATE TYPE "IntegrityStatus" AS ENUM ('CLEAN', 'FLAGGED', 'REVIEW');

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "integrityFlagCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "integrityStatus" "IntegrityStatus" NOT NULL DEFAULT 'CLEAN';

-- CreateTable
CREATE TABLE "IntegrityEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "type" "IntegrityEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrityEvent_attemptId_idx" ON "IntegrityEvent"("attemptId");

-- AddForeignKey
ALTER TABLE "IntegrityEvent" ADD CONSTRAINT "IntegrityEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
