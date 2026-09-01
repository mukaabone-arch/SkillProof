-- CreateEnum
CREATE TYPE "DocumentSeries" AS ENUM ('TAX_INVOICE', 'RECEIPT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'GENERATED', 'FAILED_NEEDS_ATTENTION');

-- AlterTable
ALTER TABLE "AssessmentRequest" ADD COLUMN     "transactionId" TEXT;

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "financialYear" TEXT NOT NULL,
    "series" "DocumentSeries" NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("financialYear","series")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "billingProfileId" TEXT NOT NULL,
    "series" "DocumentSeries" NOT NULL,
    "financialYear" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "basePaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL,
    "sgstPaise" INTEGER NOT NULL,
    "igstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "placeOfSupplyStateCode" TEXT NOT NULL,
    "sellerGstin" TEXT NOT NULL,
    "sellerLegalName" TEXT NOT NULL,
    "sellerAddress" TEXT NOT NULL,
    "sacCode" TEXT NOT NULL,
    "buyerLegalName" TEXT,
    "buyerGstin" TEXT,
    "buyerAddress" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileKey" TEXT,
    "generationAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastGenerationError" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_transactionId_key" ON "Document"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_documentNumber_key" ON "Document"("documentNumber");

-- CreateIndex
CREATE INDEX "Document_billingProfileId_idx" ON "Document"("billingProfileId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_financialYear_series_sequenceNumber_key" ON "Document"("financialYear", "series", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRequest_transactionId_key" ON "AssessmentRequest"("transactionId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES "BillingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentRequest" ADD CONSTRAINT "AssessmentRequest_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

