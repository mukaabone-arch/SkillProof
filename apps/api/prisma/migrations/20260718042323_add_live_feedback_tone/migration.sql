-- CreateEnum
CREATE TYPE "LiveFeedbackTone" AS ENUM ('POSITIVE', 'MIXED', 'NEEDS_WORK');

-- AlterTable
ALTER TABLE "LiveClaimFeedback" ADD COLUMN     "verdictTone" "LiveFeedbackTone";

-- Backfill pre-existing rows (created before this column existed) by
-- inferring tone from verdictLabel text, defaulting to MIXED when the
-- label doesn't clearly say either way. New rows always set this
-- explicitly at generation time (see LiveFeedbackService) — this backfill
-- only covers rows written before that field existed.
UPDATE "LiveClaimFeedback"
SET "verdictTone" = CASE
  WHEN "verdictLabel" ILIKE '%needs%' OR "verdictLabel" ILIKE '%below%' OR "verdictLabel" ILIKE '%not%' THEN 'NEEDS_WORK'
  WHEN "verdictLabel" ILIKE '%meets%' OR "verdictLabel" ILIKE '%strong%' OR "verdictLabel" ILIKE '%solid%' OR "verdictLabel" ILIKE '%exceeds%' THEN 'POSITIVE'
  ELSE 'MIXED'
END::"LiveFeedbackTone"
WHERE "verdictTone" IS NULL;
