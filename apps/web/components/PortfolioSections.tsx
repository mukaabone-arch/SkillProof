'use client';

/**
 * Read-only portfolio rendering — the one component both the candidate's
 * own preview (app/portfolio/page.tsx) and the employer-facing view
 * (EmployerPortfolioView.tsx) render, so the two can never visually drift.
 *
 * Structure follows docs/design/portfolio-reference/ (numbered sections,
 * one card per role/project, grouped skill chips, a quick-stats block) —
 * styling is entirely this app's own design system (Card/Badge/EmptyState,
 * --indigo/--card/--font-display tokens, .status-grid, .chip/.ui-badge),
 * not the reference's teal-and-purple scheme. Two reference elements are
 * deliberately left out regardless of styling: padded counts ("36+
 * Skills") and GPA — see this app's own portfolio design brief.
 *
 * Verification is the organising principle, not a detail: verified badges
 * and self-reported skills render in visually distinct subsections, never
 * interleaved and never styled the same (green .chip vs neutral .ui-badge).
 */
import Link from 'next/link';
import { Badge, Card, EmptyState } from '@/components/ui';
import { skillLevelName } from '@/lib/skillLevels';
import type { PortfolioViewData } from '@/lib/portfolioTypes';

interface Props {
  data: PortfolioViewData;
  /** True on the employer-facing view when the relationship is broad enough to open the portfolio but not narrow enough (no Application) to see contact details — renders a short explanation instead of silently omitting the card. */
  contactGated?: boolean;
  /** False on the employer-facing view — "Take an assessment" is an action for the candidate viewing their own zero-badges state, not something an employer can act on for someone else. */
  isOwnPortfolio?: boolean;
}

function SectionHeader({ number, label }: { number: string; label: string }) {
  return (
    <div className="portfolio-section-header">
      <span className="eyebrow">{number}</span>
      <h2>{label}</h2>
    </div>
  );
}

export default function PortfolioSections({ data, contactGated = false, isOwnPortfolio = false }: Props) {
  const { content } = data;
  const roleCount = content.experience.length;
  const projectCount = content.projects.length;
  const verifiedCount = data.verifiedBadges.length;

  return (
    <div className="portfolio-view">
      <Card elevated className="portfolio-hero">
        {data.fullName && <h1 style={{ marginBottom: 4 }}>{data.fullName}</h1>}
        {(content.headline || data.headline) && (
          <p className="portfolio-hero-title">{content.headline || data.headline}</p>
        )}
        {content.summary && <p className="portfolio-hero-summary">{content.summary}</p>}
        {(data.location || data.yearsOfExp !== null) && (
          <p className="meta">
            {data.location}
            {data.location && data.yearsOfExp !== null && ' · '}
            {data.yearsOfExp !== null && `${data.yearsOfExp} yrs experience`}
          </p>
        )}
      </Card>

      <div className="status-grid portfolio-stats">
        <div className="status-card">
          <div className="status-card-label">Roles</div>
          <div className="status-stat">{roleCount}</div>
        </div>
        <div className="status-card">
          <div className="status-card-label">Projects</div>
          <div className="status-stat">{projectCount}</div>
        </div>
        <div className="status-card">
          <div className="status-card-label">Verified badges</div>
          <div className="status-stat verified">{verifiedCount}</div>
        </div>
      </div>

      {(data.contact || contactGated || data.githubUrl || data.linkedinUrl) && (
        <Card className="portfolio-contact">
          {data.contact ? (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {data.contact.email && (
                <a href={`mailto:${data.contact.email}`} className="portfolio-contact-item">{data.contact.email}</a>
              )}
              {data.contact.phone && (
                <a href={`tel:${data.contact.phone}`} className="portfolio-contact-item">{data.contact.phone}</a>
              )}
            </div>
          ) : contactGated ? (
            <p className="meta" style={{ margin: 0 }}>
              Contact details are shared once this candidate has applied to one of your jobs.
            </p>
          ) : null}
          {(data.githubUrl || data.linkedinUrl) && (
            <div className="row" style={{ marginTop: data.contact || contactGated ? 8 : 0 }}>
              {data.githubUrl && <a href={data.githubUrl} target="_blank" rel="noopener noreferrer">GitHub</a>}
              {data.linkedinUrl && <a href={data.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
            </div>
          )}
        </Card>
      )}

      {content.experience.length > 0 && (
        <section className="portfolio-section">
          <SectionHeader number="01" label="Experience" />
          {content.experience.map((exp, i) => (
            <Card key={i} className="portfolio-entry-card">
              <h3 style={{ marginBottom: 2 }}>{exp.title}</h3>
              <p className="portfolio-entry-org">{exp.company}</p>
              {exp.dates && <span className="ui-badge ui-badge-neutral portfolio-date-pill">{exp.dates}</span>}
              {exp.bullets.length > 0 && (
                <ul className="portfolio-bullets">
                  {exp.bullets.filter(Boolean).map((b, j) => <li key={j}>{b}</li>)}
                </ul>
              )}
            </Card>
          ))}
        </section>
      )}

      <section className="portfolio-section">
        <SectionHeader number="02" label="Skills" />

        <h3 className="portfolio-subsection-title">Verified on MyAmbii</h3>
        {verifiedCount > 0 ? (
          <div className="signal-chip-row">
            {data.verifiedBadges.map((b) => (
              <Link key={b.skillId} href={`/badges/${b.verifyHash}`}>
                <span className="chip" title={`Verified ${new Date(b.issuedAt).toLocaleDateString()}`}>
                  {b.skillName} · {skillLevelName(b.level)}
                </span>
              </Link>
            ))}
          </div>
        ) : isOwnPortfolio ? (
          <EmptyState
            message="No verified skills yet — self-reported skills below aren't independently tested."
            actionLabel="Take an assessment"
            actionHref="/assessments"
          />
        ) : (
          <EmptyState message="No verified skills yet — self-reported skills below aren't independently tested." />
        )}

        {data.verifiedCertifications.length > 0 && (
          <div className="signal-chip-row" style={{ marginTop: 8 }}>
            {data.verifiedCertifications.map((c) => (
              <span key={c.id} className="chip" title={`Verified ${new Date(c.issueDate).toLocaleDateString()}`}>
                {c.name}
              </span>
            ))}
          </div>
        )}

        {content.skillGroups.length > 0 && (
          <>
            <h3 className="portfolio-subsection-title" style={{ marginTop: 20 }}>Self-reported (from resume)</h3>
            {content.skillGroups.map((g, i) => (
              <div key={i} className="portfolio-skill-group">
                <p className="portfolio-skill-category">{g.category}</p>
                <div className="signal-chip-row">
                  {g.skills.map((s, j) => (
                    <span key={j} className="ui-badge ui-badge-neutral chip-truncate">{s}</span>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      {content.projects.length > 0 && (
        <section className="portfolio-section">
          <SectionHeader number="03" label="Projects" />
          {content.projects.map((p, i) => (
            <Card key={i} className="portfolio-entry-card">
              <h3 style={{ marginBottom: 6 }}>
                {p.url ? <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a> : p.name}
              </h3>
              {p.description && <p className="portfolio-entry-description">{p.description}</p>}
              {p.technologies.length > 0 && (
                <div className="signal-chip-row">
                  {p.technologies.map((t, j) => (
                    <span key={j} className="ui-badge ui-badge-neutral chip-truncate">{t}</span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </section>
      )}

      {content.education.length > 0 && (
        <section className="portfolio-section">
          <SectionHeader number="04" label="Education" />
          {content.education.map((edu, i) => (
            <Card key={i} className="portfolio-entry-card">
              <h3 style={{ marginBottom: 2 }}>{edu.institution}</h3>
              <p className="portfolio-entry-org">{edu.degree}</p>
              {edu.dates && <span className="ui-badge ui-badge-neutral portfolio-date-pill">{edu.dates}</span>}
            </Card>
          ))}
        </section>
      )}

      {data.verifiedCertifications.length === 0 &&
        content.experience.length === 0 &&
        content.projects.length === 0 &&
        content.education.length === 0 &&
        content.skillGroups.length === 0 && (
          <Badge variant="neutral">Nothing to show yet.</Badge>
        )}
    </div>
  );
}
