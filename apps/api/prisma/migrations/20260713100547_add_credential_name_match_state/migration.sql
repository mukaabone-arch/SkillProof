-- CreateEnum
CREATE TYPE "NameMatchState" AS ENUM ('MATCH', 'MISMATCH', 'UNCHECKED');

-- AlterTable
ALTER TABLE "ExternalCredential" ADD COLUMN "nameMatchState" "NameMatchState" NOT NULL DEFAULT 'UNCHECKED';
