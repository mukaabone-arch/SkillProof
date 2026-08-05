-- CreateEnum
CREATE TYPE "OrgInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "OrgInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "status" "OrgInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgInvitation_organizationId_idx" ON "OrgInvitation"("organizationId");

-- CreateIndex
CREATE INDEX "OrgInvitation_email_idx" ON "OrgInvitation"("email");

-- AddForeignKey
ALTER TABLE "OrgInvitation" ADD CONSTRAINT "OrgInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgInvitation" ADD CONSTRAINT "OrgInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
