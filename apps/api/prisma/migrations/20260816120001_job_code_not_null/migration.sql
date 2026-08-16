-- Every row got a code from the backfill in the previous migration —
-- safe to enforce NOT NULL at the DB level now, matching CreateJobDto's
-- already-mandatory `code` field.
ALTER TABLE "Job" ALTER COLUMN "code" SET NOT NULL;
