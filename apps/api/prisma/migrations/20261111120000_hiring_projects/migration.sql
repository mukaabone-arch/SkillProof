-- Hiring projects (employers): a project groups roles; each role is one job.
CREATE TYPE "HiringProjectStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

CREATE TABLE "HiringProject" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "status" "HiringProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HiringProject_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HiringProject_orgId_status_idx" ON "HiringProject"("orgId", "status");
ALTER TABLE "HiringProject" ADD CONSTRAINT "HiringProject_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProjectRole" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "targetStartDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectRole_jobId_key" ON "ProjectRole"("jobId");
CREATE INDEX "ProjectRole_projectId_idx" ON "ProjectRole"("projectId");
ALTER TABLE "ProjectRole" ADD CONSTRAINT "ProjectRole_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "HiringProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectRole" ADD CONSTRAINT "ProjectRole_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
