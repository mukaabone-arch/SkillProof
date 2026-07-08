-- CreateTable
CREATE TABLE "QuestionServedAt" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionServedAt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionServedAt_attemptId_questionId_key" ON "QuestionServedAt"("attemptId", "questionId");

-- AddForeignKey
ALTER TABLE "QuestionServedAt" ADD CONSTRAINT "QuestionServedAt_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionServedAt" ADD CONSTRAINT "QuestionServedAt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
