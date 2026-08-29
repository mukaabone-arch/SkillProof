-- Organisation deactivation — an actual access gate (see OrgActiveGuard),
-- not a signal like OrgVerificationStatus. Purely additive: no backfill
-- needed, every existing org defaults to not-deactivated (both new
-- columns null).

-- AlterEnum: two new employer-facing notification types, same pattern as
-- the add_org_verification migration.
ALTER TYPE "NotificationType" ADD VALUE 'ORG_DEACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'ORG_REACTIVATED';

-- AlterTable
ALTER TABLE "Organization"
  ADD COLUMN "deactivatedAt" TIMESTAMP(3),
  ADD COLUMN "deactivatedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_deactivatedByUserId_fkey" FOREIGN KEY ("deactivatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
