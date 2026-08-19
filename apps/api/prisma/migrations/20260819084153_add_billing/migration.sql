-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('ASSESSMENT_REQUEST_PAYMENT', 'SUBSCRIPTION_CHARGE', 'REFUND', 'ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "AdminAccessLog" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "BillingProfile" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT,
    "organizationId" TEXT,
    "legalEntityName" TEXT NOT NULL,
    "billingEmail" TEXT NOT NULL,
    "billingPhone" TEXT,
    "gstin" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "gstStateCode" TEXT,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "billingProfileId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "description" TEXT,
    "provider" TEXT,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "amendsTransactionId" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingProfile_candidateId_key" ON "BillingProfile"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingProfile_organizationId_key" ON "BillingProfile"("organizationId");

-- CreateIndex
CREATE INDEX "BillingProfile_candidateId_idx" ON "BillingProfile"("candidateId");

-- CreateIndex
CREATE INDEX "BillingProfile_organizationId_idx" ON "BillingProfile"("organizationId");

-- CreateIndex
CREATE INDEX "Transaction_billingProfileId_idx" ON "Transaction"("billingProfileId");

-- CreateIndex
CREATE INDEX "Transaction_amendsTransactionId_idx" ON "Transaction"("amendsTransactionId");

-- CreateIndex
CREATE INDEX "AdminAccessLog_organizationId_createdAt_idx" ON "AdminAccessLog"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminAccessLog" ADD CONSTRAINT "AdminAccessLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProfile" ADD CONSTRAINT "BillingProfile_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "CandidateProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProfile" ADD CONSTRAINT "BillingProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES "BillingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amendsTransactionId_fkey" FOREIGN KEY ("amendsTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: exactly one of candidateId/organizationId — Prisma's
-- schema DSL can't express this, so it's added here by hand (same approach
-- already used elsewhere in this codebase's migrations for constraints
-- Prisma can't generate). BillingService also validates this at the
-- service layer as defense in depth.
ALTER TABLE "BillingProfile" ADD CONSTRAINT "billing_profile_exactly_one_owner"
  CHECK (("candidateId" IS NOT NULL AND "organizationId" IS NULL) OR ("candidateId" IS NULL AND "organizationId" IS NOT NULL));
