/**
 * Mirrors apps/api/src/llm/llm.service.ts's PortfolioExtraction /
 * apps/api/src/modules/portfolio/portfolio.dto.ts field-for-field. Shared
 * between the candidate's own /portfolio page (editable) and the
 * employer-facing view (read-only) so both render the exact same shape.
 */
export interface PortfolioExperienceEntry {
  title: string;
  company: string;
  dates: string;
  bullets: string[];
}

export interface PortfolioEducationEntry {
  degree: string;
  institution: string;
  dates: string;
}

export interface PortfolioProjectEntry {
  name: string;
  description: string;
  technologies: string[];
  url: string | null;
}

export interface PortfolioSkillGroup {
  category: string;
  skills: string[];
}

export interface PortfolioContent {
  headline: string | null;
  summary: string | null;
  experience: PortfolioExperienceEntry[];
  projects: PortfolioProjectEntry[];
  education: PortfolioEducationEntry[];
  skillGroups: PortfolioSkillGroup[];
}

/** SkillLevel code, e.g. "L1"–"L4" — see lib/skillLevels.ts for display names. */
export interface VerifiedBadge {
  skillId: string;
  skillName: string;
  level: string;
  verifiedBy: 'TEST' | 'DISCUSSION';
  verifyHash: string;
  issuedAt: string;
  expiresAt: string;
}

export interface VerifiedCertification {
  id: string;
  name: string;
  issuer: string;
  issuerOther: string | null;
  issueDate: string;
  expiryDate: string | null;
  credentialUrl: string | null;
}

export interface PortfolioContact {
  email: string | null;
  phone: string | null;
}

/** The read-only rendering shape — what both GET /portfolio/me and GET /portfolio/candidates/:id ultimately reduce to for display. */
export interface PortfolioViewData {
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  content: PortfolioContent;
  verifiedBadges: VerifiedBadge[];
  verifiedCertifications: VerifiedCertification[];
  /** null = not shown — either gated (employer view, relationship insufficient) or simply absent. */
  contact: PortfolioContact | null;
}

export const emptyPortfolioContent: PortfolioContent = {
  headline: null,
  summary: null,
  experience: [],
  projects: [],
  education: [],
  skillGroups: [],
};
