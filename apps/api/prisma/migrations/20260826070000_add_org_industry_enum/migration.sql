-- Structured industry dropdown, replacing the free-text Organization.industry
-- column. No backfill: as of this migration, production has exactly one
-- Organization row and its industry is already empty (null/blank) — there
-- is nothing to map or preserve. Unlike CandidateProfile.locationLegacy
-- (a real backfill across many rows of ambiguous free text), this is a
-- clean drop-and-replace. See OrgIndustry's own doc comment in
-- schema.prisma for the enum itself, and Organization.industry/
-- industryOther for the OTHER + free-text-fallback pairing.

-- CreateEnum
CREATE TYPE "OrgIndustry" AS ENUM ('TECHNOLOGY_SOFTWARE', 'AI_ML_PRODUCTS_SERVICES', 'FINANCIAL_SERVICES_FINTECH', 'HEALTHCARE_LIFE_SCIENCES', 'ECOMMERCE_RETAIL', 'CONSULTING_PROFESSIONAL_SERVICES', 'EDUCATION_EDTECH', 'MEDIA_ENTERTAINMENT', 'TELECOMMUNICATIONS', 'MANUFACTURING_INDUSTRIAL', 'ENERGY_UTILITIES', 'TRANSPORTATION_LOGISTICS', 'REAL_ESTATE_PROPTECH', 'GOVERNMENT_PUBLIC_SECTOR', 'NON_PROFIT', 'STAFFING_RECRUITMENT', 'OTHER');

-- AlterTable
ALTER TABLE "Organization"
  DROP COLUMN "industry",
  ADD COLUMN "industry" "OrgIndustry",
  ADD COLUMN "industryOther" TEXT;
