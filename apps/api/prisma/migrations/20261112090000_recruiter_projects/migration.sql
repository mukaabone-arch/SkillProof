-- Hiring projects phase 2 (recruiters): client projects and agency postings.
ALTER TABLE "Job" ADD COLUMN "postedForClientId" TEXT;
ALTER TABLE "Job" ADD COLUMN "hideClientName" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Job" ADD CONSTRAINT "Job_postedForClientId_fkey" FOREIGN KEY ("postedForClientId") REFERENCES "StaffingClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HiringProject" ADD COLUMN "clientId" TEXT;
ALTER TABLE "HiringProject" ADD CONSTRAINT "HiringProject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "StaffingClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StaffingSubmission" ADD COLUMN "projectRoleId" TEXT;
CREATE INDEX "StaffingSubmission_projectRoleId_idx" ON "StaffingSubmission"("projectRoleId");
ALTER TABLE "StaffingSubmission" ADD CONSTRAINT "StaffingSubmission_projectRoleId_fkey" FOREIGN KEY ("projectRoleId") REFERENCES "ProjectRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
