-- Every new assessment request is for one of the employer's jobs; closing the
-- job withdraws requests the candidate hasn't started (see
-- AssessmentRequestsService.withdrawForClosedJob). Both columns are nullable:
-- rows created before this have no job and keep their old behaviour, and the
-- API (not the database) is what makes jobId required for new requests.

-- CreateEnum
CREATE TYPE "AssessmentRequestExclusionReason" AS ENUM ('EXPIRED', 'CANDIDATE_UNAVAILABLE', 'JOB_CLOSED');

-- AlterTable
ALTER TABLE "AssessmentRequest" ADD COLUMN "jobId" TEXT,
ADD COLUMN "exclusionReason" "AssessmentRequestExclusionReason";

-- CreateIndex
CREATE INDEX "AssessmentRequest_jobId_idx" ON "AssessmentRequest"("jobId");

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
