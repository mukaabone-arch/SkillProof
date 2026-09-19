-- CreateTable
CREATE TABLE "CandidatePortfolio" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "visibleToEmployers" BOOLEAN NOT NULL DEFAULT false,
    "sourceResumeKey" TEXT,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidatePortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidatePortfolio_profileId_key" ON "CandidatePortfolio"("profileId");

-- AddForeignKey
ALTER TABLE "CandidatePortfolio" ADD CONSTRAINT "CandidatePortfolio_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CandidateProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
