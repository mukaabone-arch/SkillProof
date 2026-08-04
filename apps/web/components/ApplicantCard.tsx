'use client';

/**
 * Shared applicant-card rendering — extracted from EmployerJobs.tsx (where
 * this was previously inline JSX) so the per-job applicants list, the
 * org-wide /employer/applicants page, and the dashboard's recent-applicants
 * preview all render the exact same enrichment the same way, rather than
 * three near-duplicate implementations drifting apart. Per-context actions
 * (shortlist button, status-update buttons, resume download) are the
 * caller's job — passed in as `footer`, never built here — since which
 * actions make sense depends on context (a specific job vs. an org-wide
 * list vs. a read-only dashboard preview).
 */
import Link from 'next/link';
import { Badge } from '@/components/ui';
import CandidateAvatar from './CandidateAvatar';

export type CredentialIssuer = 'CREDLY' | 'AWS' | 'GOOGLE' | 'AZURE' | 'NVIDIA' | 'DATABRICKS' | 'IBM' | 'OTHER';
export type NameMatchState = 'MATCH' | 'MISMATCH' | 'UNCHECKED';

export interface ApplicantSkill {
  skillId: string;
  skillName: string;
  level: string;
  verifiedBy: 'TEST' | 'DISCUSSION';
  verifyHash: string;
}

export interface ApplicantExternalCredential {
  id: string;
  issuer: CredentialIssuer;
  name: string | null;
  credentialUrl: string;
  issuedAt: string | null;
  expiresAt: string | null;
  /** Advisory only — see NameMatchState. Never affects verification or scoring. */
  nameMatchState: NameMatchState;
}

/** Display/filter only — mirrors the API's CandidateRoleTitle enum. Never fed into match scoring. */
export type CandidateRoleTitle =
  | 'AI_ENGINEER'
  | 'ML_ENGINEER'
  | 'PROMPT_ENGINEER'
  | 'DATA_SCIENTIST'
  | 'MLOPS_ENGINEER'
  | 'NLP_ENGINEER'
  | 'COMPUTER_VISION_ENGINEER'
  | 'RESEARCH_ENGINEER'
  | 'DATA_ENGINEER'
  | 'AI_PRODUCT_MANAGER'
  | 'OTHER';

export const ROLE_TITLE_LABELS: Record<CandidateRoleTitle, string> = {
  AI_ENGINEER: 'AI Engineer',
  ML_ENGINEER: 'ML Engineer',
  PROMPT_ENGINEER: 'Prompt Engineer',
  DATA_SCIENTIST: 'Data Scientist',
  MLOPS_ENGINEER: 'MLOps Engineer',
  NLP_ENGINEER: 'NLP Engineer',
  COMPUTER_VISION_ENGINEER: 'Computer Vision Engineer',
  RESEARCH_ENGINEER: 'Research Engineer',
  DATA_ENGINEER: 'Data Engineer',
  AI_PRODUCT_MANAGER: 'AI Product Manager',
  OTHER: 'Other',
};

export const ISSUER_LABELS: Record<CredentialIssuer, string> = {
  CREDLY: 'Credly',
  AWS: 'AWS',
  GOOGLE: 'Google',
  AZURE: 'Microsoft Azure',
  NVIDIA: 'NVIDIA',
  DATABRICKS: 'Databricks',
  IBM: 'IBM',
  OTHER: 'Unknown issuer',
};

export interface ApplicantCardData {
  applicationId: string;
  status: string;
  appliedAt: string;
  profileId: string;
  fullName: string | null;
  headline: string | null;
  roleTitle: CandidateRoleTitle | null;
  roleTitleOther: string | null;
  location: string | null;
  yearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  /** Bytes are only ever fetched through the authenticated proxy endpoints — see CandidateAvatar. */
  hasPhoto: boolean;
  hasResume: boolean;
  /** True for applications that predate the apply-time profile requirement. */
  profileIncomplete: boolean;
  /** Fit against one job's requirements — null when there's no single job to score against (org-wide views). */
  score: number | null;
  verifiedSkills: ApplicantSkill[];
  /** Only ever VERIFIED, non-scoring credentials. */
  externalCredentials: ApplicantExternalCredential[];
}

interface Props {
  applicant: ApplicantCardData;
  /**
   * Rendered in the top-right row alongside the score — e.g. the per-job
   * ShortlistButton. Omitted for read-only views (org-wide list, dashboard
   * preview) where shortlisting against one specific job doesn't apply.
   */
  headerActions?: React.ReactNode;
  /**
   * Rendered inline with the GitHub/LinkedIn links — e.g. a "View resume"
   * button. Kept as a slot (not built here) because it needs a jobId and
   * per-row download state that only the per-job caller tracks.
   */
  resumeAction?: React.ReactNode;
  /**
   * Extra per-context content rendered at the bottom of the card (status-
   * update buttons, a "View job" link) — the caller's own concern, since it
   * varies by where the card is used.
   */
  footer?: React.ReactNode;
  /**
   * Read-only preview mode: name/role/headline/verified skills only — no
   * location/experience/applied-date/links/credentials. Used by the
   * dashboard's recent-applicants preview, which explicitly wants only
   * "name, headline, verified badges, photo" rather than the full card.
   */
  compact?: boolean;
}

export default function ApplicantCard({ applicant: a, headerActions, resumeAction, footer, compact = false }: Props) {
  return (
    <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', margin: 0, alignItems: 'flex-start' }}>
        <div className="row" style={{ margin: 0, alignItems: 'center' }}>
          <CandidateAvatar profileId={a.profileId} fullName={a.fullName} hasPhoto={a.hasPhoto} size={44} />
          <div>
            <strong>{a.fullName || 'Candidate'}</strong>
            {a.roleTitle && (
              <div className="meta" style={{ margin: 0 }}>
                {a.roleTitle === 'OTHER' ? a.roleTitleOther || 'Other' : ROLE_TITLE_LABELS[a.roleTitle]}
              </div>
            )}
          </div>
        </div>
        <div className="row" style={{ margin: 0 }}>
          {a.score !== null && <span className="ok">{a.score}</span>}
          {headerActions}
        </div>
      </div>

      {!compact && a.profileIncomplete && (
        <Badge variant="warning" style={{ alignSelf: 'flex-start' }}>Profile incomplete</Badge>
      )}
      {a.score !== null && (
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${a.score}%` }} />
        </div>
      )}
      {a.headline && <div className="meta">{a.headline}</div>}

      {!compact && (
        <>
          <div className="meta">
            {a.location || 'Location not set'}
            {a.yearsOfExp !== null && ` · ${a.yearsOfExp} yrs experience`}
          </div>
          <div className="meta">Applied {new Date(a.appliedAt).toLocaleDateString()}</div>

          {(a.githubUrl || a.linkedinUrl || resumeAction) && (
            <div className="row" style={{ margin: 0, alignItems: 'center' }}>
              {a.githubUrl && <a href={a.githubUrl} target="_blank" rel="noopener noreferrer">GitHub</a>}
              {a.linkedinUrl && <a href={a.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
              {resumeAction}
            </div>
          )}
        </>
      )}

      {a.verifiedSkills.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div className="meta" style={{ margin: 0, marginBottom: 4 }}>
            SkillProof-Verified Skills
          </div>
          <div className="row" style={{ flexWrap: 'wrap', margin: 0 }}>
            {a.verifiedSkills.map((s) => (
              <Link key={s.skillId} href={`/badges/${s.verifyHash}`}>
                <Badge variant="verified" title={s.verifiedBy === 'DISCUSSION' ? 'Verified by discussion' : 'Verified by test'}>
                  {s.skillName} ({s.level}) {s.verifiedBy === 'DISCUSSION' ? '💬' : ''}
                </Badge>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Distinct, non-green tier — the employer judges relevance themselves, we only present. */}
      {!compact && a.externalCredentials.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div className="meta" style={{ margin: 0, marginBottom: 4 }}>
            External Credentials
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {a.externalCredentials.map((c) => (
              <a
                key={c.id}
                href={c.credentialUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Badge variant="default">{c.name ?? 'Credential'}</Badge>
                <span className="meta" style={{ margin: 0 }}>
                  {ISSUER_LABELS[c.issuer]} · verified via Credly
                  {c.expiresAt && new Date(c.expiresAt) < new Date() ? ' · expired' : ''}
                </span>
                {c.nameMatchState === 'MISMATCH' && <Badge variant="warning">Name mismatch</Badge>}
              </a>
            ))}
          </div>
        </div>
      )}

      {footer}
    </div>
  );
}
