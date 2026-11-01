-- Staffing companies Phase 2a: client lists, representation with candidate
-- consent, no-double-submission, submission tracking.
CREATE TYPE "StaffingSubmissionStatus" AS ENUM ('PENDING_CONSENT', 'DECLINED', 'SUBMITTED', 'INTERVIEWING', 'OFFER', 'PLACED', 'NOT_SELECTED', 'WITHDRAWN');
ALTER TYPE "NotificationType" ADD VALUE 'STAFFING_SUBMISSION_CONSENT';
ALTER TYPE "NotificationType" ADD VALUE 'STAFFING_SUBMISSION_DECISION';
ALTER TYPE "NotificationType" ADD VALUE 'STAFFING_SUBMISSION_STATUS';

CREATE TABLE "StaffingClient" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "domain" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffingClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffingClient_orgId_nameKey_key" ON "StaffingClient"("orgId", "nameKey");
CREATE INDEX "StaffingClient_nameKey_idx" ON "StaffingClient"("nameKey");
CREATE INDEX "StaffingClient_domain_idx" ON "StaffingClient"("domain");
ALTER TABLE "StaffingClient" ADD CONSTRAINT "StaffingClient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StaffingSubmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "clientNameKey" TEXT NOT NULL,
    "clientDomain" TEXT,
    "status" "StaffingSubmissionStatus" NOT NULL DEFAULT 'PENDING_CONSENT',
    "consentExpiresAt" TIMESTAMP(3) NOT NULL,
    "consentedAt" TIMESTAMP(3),
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidateNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffingSubmission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffingSubmission_candidateId_clientNameKey_idx" ON "StaffingSubmission"("candidateId", "clientNameKey");
CREATE INDEX "StaffingSubmission_candidateId_clientDomain_idx" ON "StaffingSubmission"("candidateId", "clientDomain");
CREATE INDEX "StaffingSubmission_orgId_createdAt_idx" ON "StaffingSubmission"("orgId", "createdAt");
ALTER TABLE "StaffingSubmission" ADD CONSTRAINT "StaffingSubmission_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffingSubmission" ADD CONSTRAINT "StaffingSubmission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "StaffingClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffingSubmission" ADD CONSTRAINT "StaffingSubmission_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffingSubmission" ADD CONSTRAINT "StaffingSubmission_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
