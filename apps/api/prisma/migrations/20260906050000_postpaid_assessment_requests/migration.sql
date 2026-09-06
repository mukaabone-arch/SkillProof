-- Prepaid -> postpaid switch for employer assessment requests. Zero
-- AssessmentRequest rows and zero Document rows existed in production at
-- the time of this migration (confirmed directly before writing it), and
-- the only TransactionType/TransactionStatus values being renamed/added
-- had zero existing rows referencing them either (the two production
-- Transaction rows are both unrelated SUBSCRIPTION_CHARGE/SUCCEEDED) — so
-- every rename below is a clean rename, not a backfill.

-- ---------- AssessmentRequestStatus: rename PAID_PENDING_START ->
-- ACCRUED_PENDING_START, EXPIRED_REFUNDED -> EXPIRED_UNBILLED ----------
ALTER TYPE "AssessmentRequestStatus" RENAME VALUE 'PAID_PENDING_START' TO 'ACCRUED_PENDING_START';
ALTER TYPE "AssessmentRequestStatus" RENAME VALUE 'EXPIRED_REFUNDED' TO 'EXPIRED_UNBILLED';

-- ---------- AssessmentRequestStatus: remove REFUND_FAILED ----------
-- Postgres has no DROP VALUE for enums — recreate the type without it.
-- Safe here specifically because zero rows reference it (confirmed).
CREATE TYPE "AssessmentRequestStatus_new" AS ENUM ('ACCRUED_PENDING_START', 'STARTED', 'COMPLETED', 'EXPIRED_UNBILLED', 'ALREADY_BADGED');
ALTER TABLE "AssessmentRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "AssessmentRequest" ALTER COLUMN "status" TYPE "AssessmentRequestStatus_new" USING ("status"::text::"AssessmentRequestStatus_new");
ALTER TABLE "AssessmentRequest" ALTER COLUMN "status" SET DEFAULT 'ACCRUED_PENDING_START';
DROP TYPE "AssessmentRequestStatus";
ALTER TYPE "AssessmentRequestStatus_new" RENAME TO "AssessmentRequestStatus";

-- ---------- TransactionType: rename ASSESSMENT_REQUEST_PAYMENT ->
-- ASSESSMENT_REQUEST_ACCRUAL ----------
ALTER TYPE "TransactionType" RENAME VALUE 'ASSESSMENT_REQUEST_PAYMENT' TO 'ASSESSMENT_REQUEST_ACCRUAL';

-- ---------- TransactionStatus: add VOIDED ----------
ALTER TYPE "TransactionStatus" ADD VALUE 'VOIDED';

-- ---------- AssessmentRequest: drop Razorpay-specific columns ----------
-- No longer populated by any code path (postpaid — see
-- AssessmentRequestsService). Dropped, not just left unused, per the same
-- "misleading financial-data shape" reasoning as the enum renames above —
-- zero rows reference any of these.
ALTER TABLE "AssessmentRequest" DROP COLUMN "razorpayOrderId";
ALTER TABLE "AssessmentRequest" DROP COLUMN "razorpayPaymentId";
ALTER TABLE "AssessmentRequest" DROP COLUMN "razorpayRefundId";
ALTER TABLE "AssessmentRequest" DROP COLUMN "paidAt";

-- ---------- Document <-> Transaction: flip the FK direction ----------
-- Was Document.transactionId (1:1, unique). A monthly
-- ASSESSMENT_REQUEST_ACCRUAL invoice now covers many Transactions, so the
-- FK moves to the "many" side (Transaction.documentId). Zero Document rows
-- existed at migration time (confirmed) — this is a clean-slate schema
-- change, nothing to backfill.
ALTER TABLE "Document" DROP CONSTRAINT "Document_transactionId_fkey";
DROP INDEX "Document_transactionId_key";
ALTER TABLE "Document" DROP COLUMN "transactionId";

ALTER TABLE "Transaction" ADD COLUMN "documentId" TEXT;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Transaction_documentId_idx" ON "Transaction"("documentId");
