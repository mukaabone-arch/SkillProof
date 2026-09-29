-- CreateTable
CREATE TABLE "WebSessionCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebSessionCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebSessionCode_codeHash_key" ON "WebSessionCode"("codeHash");

-- CreateIndex
CREATE INDEX "WebSessionCode_expiresAt_idx" ON "WebSessionCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "WebSessionCode" ADD CONSTRAINT "WebSessionCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
