-- Employer code + admin-reviewed verification status on Organization.
-- Verification is a signal, not a gate — nothing here touches posting,
-- applying, hiring, or billing. See OrgVerificationStatus's own doc
-- comment in schema.prisma for what each status means and which of the
-- columns below are populated at each one.

-- CreateEnum
CREATE TYPE "OrgVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum: two new employer-facing notification types, same "add several
-- values in one migration" pattern already used for PIPELINE_*/
-- ASSESSMENT_REQUEST_* above — safe on Postgres 12+ since neither value is
-- referenced later in this same transaction.
ALTER TYPE "NotificationType" ADD VALUE 'ORG_VERIFICATION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'ORG_VERIFICATION_REJECTED';

-- AlterTable
-- `code` added nullable here, same reasoning as the add_job_code migration:
-- RDS already has organizations with nothing to put in this column yet.
-- NOT NULL is enforced in the migration immediately after this one, once
-- every row has a value (see the backfill below).
-- verificationStatus gets a real default (UNVERIFIED) so it can be NOT NULL
-- immediately — unlike `code`, there's a sensible value for existing rows
-- to start from, before the backfill below moves them to VERIFIED.
ALTER TABLE "Organization"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "verificationStatus" "OrgVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "verificationSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "verificationSubmittedByUserId" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedByUserId" TEXT,
  ADD COLUMN "rejectionReason" TEXT;

-- CreateIndex
-- Safe to add before every row has a code: Postgres unique indexes permit
-- any number of NULLs, same as Job_orgId_code_key.
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_verificationSubmittedByUserId_fkey" FOREIGN KEY ("verificationSubmittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Global sequence backing every org's display code (MYA-EMP-0001-style) —
-- global, not per-org like Job's JOB-#### (Job.code is also employer-typed,
-- never system-generated; this one is generated at creation time by
-- OrgsService, so it needs its own atomic counter). nextval() is atomic
-- under concurrent transactions with no explicit locking, so two orgs
-- created in the same instant can never collide; a rolled-back org create
-- burns a number, which just leaves a harmless gap in the sequence — same
-- trade-off as most systems' sequential display IDs.
CREATE SEQUENCE "organization_code_seq" START WITH 1;

-- Backfill: every existing org gets a sequential MYA-EMP-0001-style code in
-- creation order, so no row is left without one before the next migration
-- makes this NOT NULL.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt") AS rn
  FROM "Organization"
)
UPDATE "Organization"
SET "code" = 'MYA-EMP-' || LPAD(numbered.rn::text, 4, '0')
FROM numbered
WHERE "Organization"."id" = numbered."id";

-- Advance the sequence past whatever the backfill just consumed, so the
-- first runtime-generated code picks up where the backfill left off
-- instead of colliding with it. Guarded for the (unlikely, but possible on
-- a fresh environment) zero-row case: setval rejects a value below the
-- sequence's minvalue, which a plain `(SELECT COUNT(*) ...)` of 0 would hit.
DO $$
DECLARE
  org_count integer;
BEGIN
  SELECT COUNT(*) INTO org_count FROM "Organization";
  IF org_count > 0 THEN
    PERFORM setval('organization_code_seq', org_count);
  END IF;
END $$;

-- Existing orgs are auto-verified rather than left UNVERIFIED — they
-- pre-date this feature entirely and are already known/trusted. verifiedAt
-- is set to record when they entered VERIFIED; verifiedByUserId stays NULL
-- since no admin actually reviewed them (this is a system backfill, not a
-- decision) — VERIFIED rows normally carry both, this is the one
-- intentional exception, called out here rather than silently deviating
-- from the invariant documented on Organization.verificationStatus.
UPDATE "Organization"
SET "verificationStatus" = 'VERIFIED', "verifiedAt" = now();
