-- Staffing companies (Phase 1): organisation type, candidate opt-in +
-- availability, availability requests, per-company blocks.
CREATE TYPE "OrgType" AS ENUM ('EMPLOYER', 'STAFFING');
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE_NOW', 'AVAILABLE_FROM', 'NOTICE_PERIOD', 'NOT_LOOKING');
CREATE TYPE "WorkType" AS ENUM ('PERMANENT', 'CONTRACT', 'CONTRACT_TO_HIRE');
CREATE TYPE "RateUnit" AS ENUM ('ANNUAL', 'MONTHLY', 'DAILY', 'HOURLY');
CREATE TYPE "StaffingRequestStatus" AS ENUM ('PENDING', 'AVAILABLE', 'CONDITIONAL', 'NOT_NOW', 'WITHDRAWN');

ALTER TYPE "NotificationType" ADD VALUE 'STAFFING_AVAILABILITY_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE 'STAFFING_REQUEST_RESPONSE';

ALTER TABLE "Organization" ADD COLUMN "type" "OrgType" NOT NULL DEFAULT 'EMPLOYER';

ALTER TABLE "CandidateProfile"
    ADD COLUMN "openToStaffing" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "availabilityStatus" "AvailabilityStatus",
    ADD COLUMN "availableFrom" TIMESTAMP(3),
    ADD COLUMN "noticePeriodDays" INTEGER,
    ADD COLUMN "workTypes" "WorkType"[] DEFAULT ARRAY[]::"WorkType"[],
    ADD COLUMN "expectedRateMinInr" INTEGER,
    ADD COLUMN "expectedRateMaxInr" INTEGER,
    ADD COLUMN "expectedRateUnit" "RateUnit",
    ADD COLUMN "availabilityConfirmedAt" TIMESTAMP(3);

CREATE TABLE "StaffingAvailabilityRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "roleTitle" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "workType" "WorkType" NOT NULL,
    "rateMinInr" INTEGER,
    "rateMaxInr" INTEGER,
    "rateUnit" "RateUnit",
    "location" TEXT,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "clientName" TEXT,
    "clientIndustry" TEXT,
    "status" "StaffingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "candidateMessage" TEXT,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffingAvailabilityRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffingAvailabilityRequest_candidateId_createdAt_idx" ON "StaffingAvailabilityRequest"("candidateId", "createdAt");
CREATE INDEX "StaffingAvailabilityRequest_orgId_createdAt_idx" ON "StaffingAvailabilityRequest"("orgId", "createdAt");
ALTER TABLE "StaffingAvailabilityRequest" ADD CONSTRAINT "StaffingAvailabilityRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffingAvailabilityRequest" ADD CONSTRAINT "StaffingAvailabilityRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffingAvailabilityRequest" ADD CONSTRAINT "StaffingAvailabilityRequest_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StaffingBlock" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffingBlock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StaffingBlock_candidateId_orgId_key" ON "StaffingBlock"("candidateId", "orgId");
ALTER TABLE "StaffingBlock" ADD CONSTRAINT "StaffingBlock_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffingBlock" ADD CONSTRAINT "StaffingBlock_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
