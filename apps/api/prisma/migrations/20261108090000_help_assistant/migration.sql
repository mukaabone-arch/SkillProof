-- In-app help assistant: one row per question/answer, kept 90 days.
-- HELP_ANSWER lets users report an assistant answer like other AI content.
ALTER TYPE "AiContentTarget" ADD VALUE 'HELP_ANSWER';

CREATE TYPE "HelpAudience" AS ENUM ('CANDIDATE', 'EMPLOYER', 'RECRUITER');

CREATE TABLE "HelpQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "audience" "HelpAudience" NOT NULL,
    "platform" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "covered" BOOLEAN NOT NULL,
    "sectionIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HelpQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HelpQuestion_userId_createdAt_idx" ON "HelpQuestion"("userId", "createdAt");
CREATE INDEX "HelpQuestion_createdAt_idx" ON "HelpQuestion"("createdAt");
ALTER TABLE "HelpQuestion" ADD CONSTRAINT "HelpQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
