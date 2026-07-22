-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProfileViewSource" AS ENUM ('DETAIL_VIEW', 'SHORTLIST', 'REJECT', 'MESSAGE', 'STATUS_CHANGE');

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "attemptNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Badge" ADD COLUMN     "attemptNumber" INTEGER;

-- Backfill: give every pre-existing Attempt row its real ordinal number
-- instead of leaving the DEFAULT 1 on all of them — attemptNumber is meant
-- to be a genuine "which try was this" count (see the column's doc comment
-- in schema.prisma), and that's computable for historical data via a
-- per-(user, skill) window function, ordered by creation time.
UPDATE "Attempt" a
SET "attemptNumber" = numbered."rn"
FROM (
    SELECT a2."id", ROW_NUMBER() OVER (
        PARTITION BY a2."userId", ass."skillId"
        ORDER BY a2."createdAt"
    ) AS "rn"
    FROM "Attempt" a2
    JOIN "Assessment" ass ON ass."id" = a2."assessmentId"
) AS numbered
WHERE a."id" = numbered."id";

-- Backfill: copy the now-correct attemptNumber onto every already-issued,
-- attempt-backed Badge (session-issued badges have attemptId NULL and stay
-- untouched — see the column's doc comment).
UPDATE "Badge" b
SET "attemptNumber" = a."attemptNumber"
FROM "Attempt" a
WHERE b."attemptId" = a."id";

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "provider" TEXT,
    "providerSubId" TEXT,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileView" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "source" "ProfileViewSource" NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_candidateId_key" ON "Subscription"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_candidateId_metric_periodStart_key" ON "UsageCounter"("candidateId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "ProfileView_candidateId_viewedAt_idx" ON "ProfileView"("candidateId", "viewedAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileView" ADD CONSTRAINT "ProfileView_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileView" ADD CONSTRAINT "ProfileView_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
