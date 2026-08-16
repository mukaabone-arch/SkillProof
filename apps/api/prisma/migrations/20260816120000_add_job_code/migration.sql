-- Employer-facing requisition reference, mandatory going forward (see
-- CreateJobDto.code) but added nullable here since RDS already has job rows
-- with nothing to put in this column yet — same reasoning as the
-- add_structured_job_location migration: never a NOT NULL in the same
-- statement as adding the column. NOT NULL is enforced in the migration
-- immediately after this one, once every row has a value (see the backfill
-- below).

-- AlterTable: add the column; nothing destructive yet.
ALTER TABLE "Job" ADD COLUMN "code" TEXT;

-- Unique per organisation, not globally — two different employers each
-- using "SWE-01" is an expected requisition-numbering collision, not a
-- conflict (JobsService.create/update translate the resulting P2002 into a
-- 409). Safe to add before every row has a code: Postgres unique indexes
-- permit any number of NULLs.
CREATE UNIQUE INDEX "Job_orgId_code_key" ON "Job"("orgId", "code");

-- Backfill: every existing job gets a sequential JOB-0001-style code,
-- numbered per org (matching the constraint above) in posting order, so no
-- row is left without one before the next migration makes this NOT NULL.
WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "orgId" ORDER BY "createdAt") AS rn
  FROM "Job"
)
UPDATE "Job"
SET "code" = 'JOB-' || LPAD(numbered.rn::text, 4, '0')
FROM numbered
WHERE "Job"."id" = numbered."id";
