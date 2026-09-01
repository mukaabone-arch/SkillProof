-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "salaryCurrency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "salaryNotDisclosed" BOOLEAN NOT NULL DEFAULT false;

