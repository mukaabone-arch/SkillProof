-- Setup-checklist fields for the employer dashboard's "Set up your
-- organisation" card (industry, website, logo). All three are optional —
-- nothing in this feature gates job posting or hiring — so, unlike the
-- recent Job.code addition, there's no backfill and no follow-up NOT NULL
-- migration: every existing org just starts with all three unset, which is
-- the correct "not done yet" state for the checklist to read.
ALTER TABLE "Organization"
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "logoKey" TEXT;
