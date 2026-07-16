-- AlterTable
ALTER TABLE "AssessmentSession" ADD COLUMN     "preDisputeStatus" "AssessmentSessionStatus";

-- AlterTable
ALTER TABLE "ClaimDispute" ADD COLUMN     "upheld" BOOLEAN;

