-- Bulk job import: drafts from one upload share an importBatchId.
ALTER TABLE "Job" ADD COLUMN "importBatchId" TEXT;
CREATE INDEX "Job_orgId_importBatchId_idx" ON "Job"("orgId", "importBatchId");
