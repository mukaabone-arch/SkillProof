-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "isInternalTestAccount" BOOLEAN NOT NULL DEFAULT false;

-- One-time backfill for the internal/QA candidate accounts identified in the
-- 2026-09-08 pre-launch investigation (see CandidateProfile.isInternalTestAccount's
-- own doc comment): all five had zero verified skills, zero applications, and
-- zero shortlist entries at the time of this migration, so this backfill is a
-- pure labeling change — it makes candidateVisibilityFilter's existing
-- exclusion effective going forward, not a change to anything these accounts
-- were already surfaced in.
--
-- Matched by email/phone rather than a hardcoded CandidateProfile id, so this
-- resolves correctly against whichever environment actually has these rows
-- (identifiers can differ between dev/staging/prod for the same real signup).
UPDATE "CandidateProfile" cp
SET "isInternalTestAccount" = true
FROM "User" u
WHERE cp."userId" = u."id"
  AND (
    u."email" IN ('test@myambii.com', 'myambii02@gmail.com', 'hurzukhome@gmail.com', 'abdul.hurzuk@gmail.com')
    OR u."phone" = '+919136070166'
  );
