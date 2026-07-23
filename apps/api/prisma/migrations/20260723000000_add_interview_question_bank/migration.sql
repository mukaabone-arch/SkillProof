-- CreateEnum
CREATE TYPE "InterviewQuestionCategory" AS ENUM ('PROBLEM_SOLVING', 'CONFLICT', 'TEAMWORK', 'INITIATIVE', 'MOTIVATION', 'SELF_AWARENESS', 'AMBITION', 'INDUSTRY_AWARENESS', 'CULTURE_FIT', 'COMMUNICATION');

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "category" "InterviewQuestionCategory" NOT NULL,
    "whatToLookFor" TEXT NOT NULL,
    "expectedElements" JSONB NOT NULL,
    "followUpProbes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isCompanyGrounded" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewQuestion_category_idx" ON "InterviewQuestion"("category");

-- CreateIndex
CREATE INDEX "InterviewQuestion_active_idx" ON "InterviewQuestion"("active");
