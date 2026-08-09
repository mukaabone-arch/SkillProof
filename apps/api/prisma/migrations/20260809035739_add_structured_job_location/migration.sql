-- Structured city selection replaces the free-text location field on Job,
-- mirroring the CandidateProfile add_structured_location migration, so
-- candidate and job locations are stored in the same shape and matching
-- compares like with like. Order matters here (unlike a plain
-- Prisma-generated diff, which would DROP "location" in the same statement
-- as adding the new columns): the new columns are added first, the old
-- column's values are copied into locationLegacy, and only then is
-- "location" dropped — so there is never a moment where an existing job's
-- location value exists nowhere.

-- AlterTable: add every new column; nothing destructive yet.
ALTER TABLE "Job"
  ADD COLUMN "locationCity" TEXT,
  ADD COLUMN "locationRegion" TEXT,
  ADD COLUMN "locationCountry" TEXT,
  ADD COLUMN "locationPlaceId" TEXT,
  ADD COLUMN "locationLat" DOUBLE PRECISION,
  ADD COLUMN "locationLng" DOUBLE PRECISION,
  ADD COLUMN "locationLegacy" TEXT;

-- Backfill: preserve every existing free-text location value. Jobs show
-- this as their current location (formatLocation) until the employer
-- re-selects a city from the new dropdown, which populates the structured
-- columns above and makes this legacy value fall out of display (though it
-- stays in the row, never deleted).
UPDATE "Job" SET "locationLegacy" = "location" WHERE "location" IS NOT NULL;

-- Now safe to drop — every value has been copied.
ALTER TABLE "Job" DROP COLUMN "location";
