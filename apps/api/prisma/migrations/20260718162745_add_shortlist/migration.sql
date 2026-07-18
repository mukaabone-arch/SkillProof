-- CreateEnum
CREATE TYPE "ShortlistStage" AS ENUM ('SHORTLISTED', 'INVITED', 'INTERVIEWING', 'OFFER', 'HIRED', 'DECLINED', 'REJECTED', 'CLOSED');

-- CreateTable
CREATE TABLE "ShortlistEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT,
    "addedByUserId" TEXT NOT NULL,
    "stage" "ShortlistStage" NOT NULL DEFAULT 'SHORTLISTED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShortlistEntry_orgId_stage_idx" ON "ShortlistEntry"("orgId", "stage");

-- CreateIndex
CREATE INDEX "ShortlistEntry_jobId_idx" ON "ShortlistEntry"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortlistEntry_orgId_candidateId_jobId_key" ON "ShortlistEntry"("orgId", "candidateId", "jobId");

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
