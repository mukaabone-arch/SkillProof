-- Candidate-only interview prep checklist (see InterviewPrepProgress in schema.prisma).
CREATE TABLE "InterviewPrepProgress" (
    "shortlistEntryId" TEXT NOT NULL,
    "done" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InterviewPrepProgress_pkey" PRIMARY KEY ("shortlistEntryId")
);

ALTER TABLE "InterviewPrepProgress" ADD CONSTRAINT "InterviewPrepProgress_shortlistEntryId_fkey"
    FOREIGN KEY ("shortlistEntryId") REFERENCES "ShortlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
