-- CreateTable
CREATE TABLE "TurnSignals" (
    "id" TEXT NOT NULL,
    "sessionTurnId" TEXT NOT NULL,
    "pasteCount" INTEGER,
    "pastedCharCount" INTEGER,
    "largestPasteChars" INTEGER,
    "timeToFirstKeystrokeMs" INTEGER,
    "compositionDurationMs" INTEGER,
    "charCount" INTEGER,
    "effectiveWpm" DOUBLE PRECISION,
    "blurCount" INTEGER,
    "blurDurationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnSignals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TurnSignals_sessionTurnId_key" ON "TurnSignals"("sessionTurnId");

-- AddForeignKey
ALTER TABLE "TurnSignals" ADD CONSTRAINT "TurnSignals_sessionTurnId_fkey" FOREIGN KEY ("sessionTurnId") REFERENCES "SessionTurn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

