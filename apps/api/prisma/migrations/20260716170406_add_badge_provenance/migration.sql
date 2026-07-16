-- CreateEnum
CREATE TYPE "BadgeVerificationMethod" AS ENUM ('TEST', 'DISCUSSION');

-- AlterTable: Skill gets a nullable description (no backfill needed for existing rows)
ALTER TABLE "Skill" ADD COLUMN     "description" TEXT;

-- AlterTable: Badge gets skillId/verifiedBy, added nullable first so existing
-- rows can be backfilled before the NOT NULL constraint is applied.
ALTER TABLE "Badge" ADD COLUMN     "skillId" TEXT,
ADD COLUMN     "verifiedBy" "BadgeVerificationMethod";

-- Backfill: attempt-issued badges -> TEST, skillId via the attempt's assessment.
UPDATE "Badge" b
SET "skillId" = a."skillId",
    "verifiedBy" = 'TEST'
FROM "Attempt" att
JOIN "Assessment" a ON a.id = att."assessmentId"
WHERE b."attemptId" = att.id;

-- Backfill: session-issued badges -> DISCUSSION. The conversational flow is
-- single-skill by construction today (hardcoded SKILL_NAME = 'RAG Systems' in
-- rag-systems-l2.rubric.ts) so this is the same lookup ReviewService.decide
-- already does at issuance time, just applied retroactively.
UPDATE "Badge" b
SET "skillId" = s.id,
    "verifiedBy" = 'DISCUSSION'
FROM "Skill" s
WHERE b."sessionId" IS NOT NULL
  AND s.name = 'RAG Systems';

-- Now safe to enforce NOT NULL — every existing row was backfilled above.
ALTER TABLE "Badge" ALTER COLUMN "skillId" SET NOT NULL;
ALTER TABLE "Badge" ALTER COLUMN "verifiedBy" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Badge_userId_skillId_level_idx" ON "Badge"("userId", "skillId", "level");

-- AddForeignKey
ALTER TABLE "Badge" ADD CONSTRAINT "Badge_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
