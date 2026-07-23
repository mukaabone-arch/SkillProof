-- Structured city selection replaces the free-text location field, without
-- dropping existing candidates' values. Order matters here (unlike a plain
-- Prisma-generated diff, which would DROP "location" in the same statement
-- as adding the new columns): the new columns are added first, the old
-- column's values are copied into locationLegacy, and only then is
-- "location" dropped — so there is never a moment where a value with 3+
-- rows of real candidate data (see the migrate diff warning this was
-- authored against) exists nowhere.

-- AlterTable: add every new column; nothing destructive yet.
ALTER TABLE "CandidateProfile"
  ADD COLUMN "locationCity" TEXT,
  ADD COLUMN "locationRegion" TEXT,
  ADD COLUMN "locationCountry" TEXT,
  ADD COLUMN "locationPlaceId" TEXT,
  ADD COLUMN "locationLat" DOUBLE PRECISION,
  ADD COLUMN "locationLng" DOUBLE PRECISION,
  ADD COLUMN "locationLegacy" TEXT,
  ADD COLUMN "openToRemote" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve every existing free-text location value. Candidates
-- see this as their current location (ProfilesService.formatCandidateLocation)
-- until they re-select a city from the new dropdown, which populates the
-- structured columns above and makes this legacy value fall out of display
-- (though it stays in the row, never deleted).
UPDATE "CandidateProfile" SET "locationLegacy" = "location" WHERE "location" IS NOT NULL;

-- Now safe to drop — every value has been copied.
ALTER TABLE "CandidateProfile" DROP COLUMN "location";
