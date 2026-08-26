/**
 * Structured industry dropdown — mirrors the API's OrgIndustry enum (see
 * schema.prisma). Single shared source for the label map and option list,
 * unlike CandidateRoleTitle's ROLE_TITLE_LABELS, which is independently
 * duplicated across four components — every consumer here imports this
 * instead of redeclaring it.
 */
export type OrgIndustry =
  | 'TECHNOLOGY_SOFTWARE'
  | 'AI_ML_PRODUCTS_SERVICES'
  | 'FINANCIAL_SERVICES_FINTECH'
  | 'HEALTHCARE_LIFE_SCIENCES'
  | 'ECOMMERCE_RETAIL'
  | 'CONSULTING_PROFESSIONAL_SERVICES'
  | 'EDUCATION_EDTECH'
  | 'MEDIA_ENTERTAINMENT'
  | 'TELECOMMUNICATIONS'
  | 'MANUFACTURING_INDUSTRIAL'
  | 'ENERGY_UTILITIES'
  | 'TRANSPORTATION_LOGISTICS'
  | 'REAL_ESTATE_PROPTECH'
  | 'GOVERNMENT_PUBLIC_SECTOR'
  | 'NON_PROFIT'
  | 'STAFFING_RECRUITMENT'
  | 'OTHER';

/** Declaration order here is the dropdown's display order — not alphabetical. */
export const ORG_INDUSTRY_LABELS: Record<OrgIndustry, string> = {
  TECHNOLOGY_SOFTWARE: 'Technology & Software',
  AI_ML_PRODUCTS_SERVICES: 'AI/ML Products & Services',
  FINANCIAL_SERVICES_FINTECH: 'Financial Services & Fintech',
  HEALTHCARE_LIFE_SCIENCES: 'Healthcare & Life Sciences',
  ECOMMERCE_RETAIL: 'E-commerce & Retail',
  CONSULTING_PROFESSIONAL_SERVICES: 'Consulting & Professional Services',
  EDUCATION_EDTECH: 'Education & EdTech',
  MEDIA_ENTERTAINMENT: 'Media & Entertainment',
  TELECOMMUNICATIONS: 'Telecommunications',
  MANUFACTURING_INDUSTRIAL: 'Manufacturing & Industrial',
  ENERGY_UTILITIES: 'Energy & Utilities',
  TRANSPORTATION_LOGISTICS: 'Transportation & Logistics',
  REAL_ESTATE_PROPTECH: 'Real Estate & PropTech',
  GOVERNMENT_PUBLIC_SECTOR: 'Government & Public Sector',
  NON_PROFIT: 'Non-profit',
  STAFFING_RECRUITMENT: 'Staffing & Recruitment',
  OTHER: 'Other',
};

export const ORG_INDUSTRY_OPTIONS = (Object.keys(ORG_INDUSTRY_LABELS) as OrgIndustry[]).map((value) => ({
  value,
  label: ORG_INDUSTRY_LABELS[value],
}));

/** Display text for a stored (industry, industryOther) pair — null when industry itself is unset. */
export function formatOrgIndustry(industry: OrgIndustry | null, industryOther: string | null): string | null {
  if (!industry) return null;
  return industry === 'OTHER' ? industryOther || 'Other' : ORG_INDUSTRY_LABELS[industry];
}
