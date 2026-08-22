-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_createdByAdminId_fkey";

-- AlterTable
ALTER TABLE "BillingProfile" ALTER COLUMN "legalEntityName" DROP NOT NULL,
ALTER COLUMN "billingEmail" DROP NOT NULL,
ALTER COLUMN "addressLine1" DROP NOT NULL,
ALTER COLUMN "city" DROP NOT NULL,
ALTER COLUMN "state" DROP NOT NULL,
ALTER COLUMN "postalCode" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "lastWebhookEventAt" TIMESTAMP(3),
ADD COLUMN     "providerPlanId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "createdByAdminId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "RazorpayWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerSubId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "applied" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RazorpayWebhookEvent_providerSubId_idx" ON "RazorpayWebhookEvent"("providerSubId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_providerSubId_key" ON "Subscription"("providerSubId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
