-- AlterTable
ALTER TABLE "CandidateProfile" ADD COLUMN     "freeSkillLockExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeSkillLockId" TEXT,
ADD COLUMN     "freeSkillLockedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "CandidateProfile" ADD CONSTRAINT "CandidateProfile_freeSkillLockId_fkey" FOREIGN KEY ("freeSkillLockId") REFERENCES "Skill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Grandfather backfill for the single-skill-lock rollout (see
-- CandidateProfile.freeSkillLockExempt's own doc comment in schema.prisma).
-- Computed from historical Attempt data regardless of a candidate's CURRENT
-- subscription tier, not just candidates who happen to be FREE today —
-- someone PREMIUM now who used >1 skill while previously FREE, or who
-- downgrades to FREE later, must never retroactively hit a restriction that
-- didn't exist when they made those attempts.
--
-- Candidates with attempts in exactly one distinct skill so far: proactively
-- lock them to that skill now, at their earliest attempt's timestamp, so
-- their very next self-serve attempt (in that same skill) isn't treated as
-- "first ever" and doesn't silently re-lock them to a different skill if
-- they happen to try one before returning to their usual one.
WITH candidate_skill_attempts AS (
  SELECT cp.id AS "candidateId", asmt."skillId", MIN(a."createdAt") AS "firstAttemptAt"
  FROM "Attempt" a
  JOIN "Assessment" asmt ON asmt.id = a."assessmentId"
  JOIN "CandidateProfile" cp ON cp."userId" = a."userId"
  GROUP BY cp.id, asmt."skillId"
),
candidate_skill_counts AS (
  SELECT "candidateId", COUNT(*) AS distinct_skills
  FROM candidate_skill_attempts
  GROUP BY "candidateId"
),
single_skill_candidates AS (
  SELECT csa."candidateId", csa."skillId", csa."firstAttemptAt"
  FROM candidate_skill_attempts csa
  JOIN candidate_skill_counts csc ON csc."candidateId" = csa."candidateId"
  WHERE csc.distinct_skills = 1
)
UPDATE "CandidateProfile" cp
SET "freeSkillLockId" = ssc."skillId", "freeSkillLockedAt" = ssc."firstAttemptAt"
FROM single_skill_candidates ssc
WHERE cp.id = ssc."candidateId";

-- Candidates with attempts already spread across more than one distinct
-- skill: permanently exempt rather than retroactively picking one skill and
-- stripping access to the others they already legitimately used under the
-- old unlimited-skills rule.
WITH candidate_skill_counts AS (
  SELECT cp.id AS "candidateId", COUNT(DISTINCT asmt."skillId") AS distinct_skills
  FROM "Attempt" a
  JOIN "Assessment" asmt ON asmt.id = a."assessmentId"
  JOIN "CandidateProfile" cp ON cp."userId" = a."userId"
  GROUP BY cp.id
),
multi_skill_candidates AS (
  SELECT "candidateId" FROM candidate_skill_counts WHERE distinct_skills > 1
)
UPDATE "CandidateProfile" cp
SET "freeSkillLockExempt" = true
FROM multi_skill_candidates msc
WHERE cp.id = msc."candidateId";
