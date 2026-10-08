'use client';

/**
 * AI resume builder — two paths into the same editable review + PDF-generate
 * step: "Improve my resume" (upload → LlmService.improveResume → edit) and
 * "Build from my profile" (profile + verified badges, plus — when a parsed
 * portfolio exists — a group/skill selector sourced from it; see
 * startFromProfile). Nothing here is ever written back to the candidate's
 * profile; the PDF is a one-off download built server-side from whatever's
 * in the review form at the moment "Generate PDF" is clicked.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, apiBlob, getToken } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { Button, Card, ErrorState, Field, LoadingState } from '@/components/ui';
import { useEntitlements } from '@/lib/entitlements';
import { RESUME_SKILLS_MAX, RESUME_SKILL_MAX_LENGTH } from '@/lib/resumeLimits';
import type { PortfolioContent, PortfolioSkillGroup, VerifiedBadge } from '@/lib/portfolioTypes';

interface ExperienceEntry {
  title: string;
  company: string;
  dates: string;
  bullets: string[];
}
interface EducationEntry {
  degree: string;
  institution: string;
  dates: string;
}
interface ResumeContent {
  summary: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
}

const emptyContent: ResumeContent = { summary: '', experience: [], education: [], skills: [] };
const emptyExperience: ExperienceEntry = { title: '', company: '', dates: '', bullets: [''] };
const emptyEducation: EducationEntry = { degree: '', institution: '', dates: '' };

type Stage = 'choose' | 'upload' | 'review';

interface PortfolioMeResponse {
  content: PortfolioContent | null;
  verifiedBadges: VerifiedBadge[];
}

/** A skill's identity for selection purposes is (group index, name), not just name — two groups could in principle repeat a name, and this keeps their checkboxes independent. */
function skillKey(groupIndex: number, skill: string): string {
  return `${groupIndex}:${skill}`;
}

function skillsFromKeys(groups: PortfolioSkillGroup[], keys: Set<string>): string[] {
  return groups.flatMap((g, gi) => g.skills.filter((s) => keys.has(skillKey(gi, s))));
}

/**
 * "Sensible rather than empty": the groups whose skills overlap a verified
 * badge are the ones the product can already stand behind, so they're the
 * default. A candidate with no verified badges yet (or whose badges don't
 * name-match anything in the parse) still gets a non-empty starting point —
 * the single largest group — rather than an empty selector with no obvious
 * next step.
 */
function defaultSelection(groups: PortfolioSkillGroup[], verifiedBadges: VerifiedBadge[]): Set<string> {
  const verifiedNames = new Set(verifiedBadges.map((b) => b.skillName.toLowerCase()));
  const withIndex = groups.map((g, gi) => ({ gi, g }));
  const overlapping = withIndex.filter(({ g }) => g.skills.some((s) => verifiedNames.has(s.toLowerCase())));

  const chosen =
    overlapping.length > 0
      ? overlapping
      : withIndex.length > 0
        ? [withIndex.reduce((max, cur) => (cur.g.skills.length > max.g.skills.length ? cur : max))]
        : [];

  return new Set(chosen.flatMap(({ gi, g }) => g.skills.map((s) => skillKey(gi, s))));
}

export default function ResumePage() {
  const { limits } = useEntitlements();
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [stage, setStage] = useState<Stage>('choose');
  const [content, setContent] = useState<ResumeContent>(emptyContent);

  const [hasExistingResume, setHasExistingResume] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [improving, setImproving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Which path populated `content` — the group selector below only applies
  // to the profile-sourced path; "Improve my resume" already returns a flat
  // AI-written list with no groups to choose from.
  const [source, setSource] = useState<'profile' | 'improve' | null>(null);
  const [portfolioSkillGroups, setPortfolioSkillGroups] = useState<PortfolioSkillGroup[]>([]);
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<Set<string>>(new Set());
  const [loadingProfile, setLoadingProfile] = useState(false);

  useEffect(() => {
    const hasToken = !!getToken();
    setLoggedIn(hasToken);
    setReady(true);
    if (hasToken) {
      api<{ resumeS3Key: string | null }>('/profiles/me')
        .then((p) => setHasExistingResume(!!p.resumeS3Key))
        .catch(() => undefined);
    }
  }, []);

  async function improveExistingResume() {
    setImproving(true);
    setError('');
    try {
      const result = await api<ResumeContent>('/profiles/me/resume/improve', { method: 'POST' });
      setSource('improve');
      setPortfolioSkillGroups([]);
      setSelectedSkillKeys(new Set());
      setContent(result);
      setStage('review');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImproving(false);
    }
  }

  async function uploadThenImprove() {
    if (!resumeFile) return;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', resumeFile);
      await api('/profiles/me/resume', { method: 'POST', body });
      setHasExistingResume(true);
    } catch (e) {
      setError((e as Error).message);
      setUploading(false);
      return;
    }
    setUploading(false);
    await improveExistingResume();
  }

  /**
   * GenerateResumeDto is all-optional, so a bare "Build from my profile"
   * used to send an empty body and let the server build from the profile +
   * badges alone — no skills, no form to overflow. Reading the candidate's
   * own portfolio here (GET /portfolio/me, already candidate-facing — see
   * PortfolioController) is what lets this path offer a selection at all;
   * without a parsed portfolio it falls back to exactly the old behaviour,
   * an empty, hand-editable skills field.
   */
  async function startFromProfile() {
    setError('');
    setSource('profile');
    setLoadingProfile(true);
    try {
      const res = await api<PortfolioMeResponse>('/portfolio/me');
      const groups = res.content?.skillGroups ?? [];
      const defaults = defaultSelection(groups, res.verifiedBadges ?? []);
      setPortfolioSkillGroups(groups);
      setSelectedSkillKeys(defaults);
      setContent({ ...emptyContent, skills: skillsFromKeys(groups, defaults) });
    } catch {
      // No parsed portfolio, or a transient read failure — "Build from my
      // profile" has always worked without one; fall back to the plain
      // empty, hand-editable field rather than blocking on this read.
      setPortfolioSkillGroups([]);
      setSelectedSkillKeys(new Set());
      setContent(emptyContent);
    } finally {
      setLoadingProfile(false);
      setStage('review');
    }
  }

  function toggleSkill(groupIndex: number, skill: string) {
    const key = skillKey(groupIndex, skill);
    const next = new Set(selectedSkillKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    applySelection(next);
  }

  function toggleGroup(groupIndex: number) {
    const keys = portfolioSkillGroups[groupIndex].skills.map((s) => skillKey(groupIndex, s));
    const allSelected = keys.every((k) => selectedSkillKeys.has(k));
    const next = new Set(selectedSkillKeys);
    for (const k of keys) {
      if (allSelected) next.delete(k);
      else next.add(k);
    }
    applySelection(next);
  }

  function applySelection(next: Set<string>) {
    setSelectedSkillKeys(next);
    setContent((c) => ({ ...c, skills: skillsFromKeys(portfolioSkillGroups, next) }));
  }

  async function generatePdf() {
    setGenerating(true);
    setError('');
    try {
      const blob = await apiBlob('/profiles/me/resume/generate', {
        method: 'POST',
        body: JSON.stringify(content),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'resume.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function updateExperience(index: number, patch: Partial<ExperienceEntry>) {
    setContent((c) => ({
      ...c,
      experience: c.experience.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    }));
  }
  function removeExperience(index: number) {
    setContent((c) => ({ ...c, experience: c.experience.filter((_, i) => i !== index) }));
  }
  function updateEducation(index: number, patch: Partial<EducationEntry>) {
    setContent((c) => ({
      ...c,
      education: c.education.map((e, i) => (i === index ? { ...e, ...patch } : e)),
    }));
  }
  function removeEducation(index: number) {
    setContent((c) => ({ ...c, education: c.education.filter((_, i) => i !== index) }));
  }

  // The DTO caps skills at RESUME_SKILLS_MAX entries of RESUME_SKILL_MAX_LENGTH
  // characters each (see lib/resumeLimits.ts) — enforced here too, live, so a
  // candidate with a full CV sees the problem while editing rather than after
  // a "Generate PDF" that was always going to fail.
  const skillsCount = content.skills.length;
  const skillsOverCount = skillsCount > RESUME_SKILLS_MAX;
  const overLongSkills = content.skills.filter((s) => s.length > RESUME_SKILL_MAX_LENGTH);
  const skillsInvalid = skillsOverCount || overLongSkills.length > 0;

  if (!ready) return <main className="container-reading"><p>Loading…</p></main>;

  return (
    <>
      {loggedIn && <CandidateNav onLoggedOut={() => setLoggedIn(false)} />}
      <main className="hub container-reading">
        <h1>Build your resume</h1>
        <p>Generate a clean, one-page PDF resume — including your verified skill badges.</p>

        {!loggedIn && (
          <ErrorState message={<>You are not logged in — <Link href="/candidate">log in first</Link> to build a resume.</>} />
        )}

        {loggedIn && error && <ErrorState message={error} />}

        {loggedIn && stage === 'choose' && (
          <div className="resume-options">
            <Card elevated className="resume-option-card">
              <h3 style={{ marginBottom: 8 }}>Improve my resume</h3>
              <p className="meta" style={{ marginBottom: 16 }}>
                Upload your resume — Claude rewrites it with stronger bullets and a tighter summary.
                Review and edit everything before downloading.
              </p>
              <Button onClick={() => setStage('upload')}>Improve my resume</Button>
            </Card>
            <Card elevated className="resume-option-card">
              <h3 style={{ marginBottom: 8 }}>Build from my profile</h3>
              <p className="meta" style={{ marginBottom: 16 }}>
                Generate a resume from your profile and verified skill badges — no upload needed.
              </p>
              <Button variant="secondary" onClick={startFromProfile} disabled={loadingProfile}>
                {loadingProfile ? 'Loading…' : 'Build from my profile'}
              </Button>
            </Card>
          </div>
        )}

        {loggedIn && stage === 'upload' && (
          <Card elevated style={{ maxWidth: 480 }}>
            {hasExistingResume && (
              <>
                <p style={{ marginBottom: 12 }}>You already have a resume on file.</p>
                <Button onClick={improveExistingResume} disabled={improving} style={{ marginBottom: 16 }}>
                  {improving ? 'Improving…' : 'Improve my existing resume'}
                </Button>
                <p className="meta" style={{ marginBottom: 12 }}>Or upload a different one:</p>
              </>
            )}
            <div className="field">
              <label htmlFor="resumeFile">PDF resume (max 5MB)</label>
              <input
                id="resumeFile"
                type="file"
                accept="application/pdf"
                onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button onClick={uploadThenImprove} disabled={!resumeFile || uploading || improving}>
              {uploading ? 'Uploading…' : 'Upload & improve'}
            </Button>
            {improving && (
              <div style={{ marginTop: 16 }}>
                <LoadingState message="Claude is rewriting your resume — this can take up to 15 seconds…" />
              </div>
            )}
          </Card>
        )}

        {loggedIn && stage === 'review' && (
          <Card elevated>
            <h2 style={{ marginBottom: 4 }}>Review your resume</h2>
            <p className="meta" style={{ marginBottom: 20 }}>
              Edit anything below — nothing is saved to your profile until you download the PDF.
            </p>

            <div className="field">
              <label htmlFor="summary">Summary</label>
              <textarea
                id="summary"
                rows={3}
                value={content.summary}
                onChange={(e) => setContent({ ...content, summary: e.target.value })}
                placeholder="A 2-3 sentence professional summary…"
              />
            </div>

            <h3 style={{ marginTop: 24, marginBottom: 12 }}>Experience</h3>
            {content.experience.map((exp, i) => (
              <Card key={i} style={{ marginBottom: 12 }}>
                <Field label="Title" value={exp.title} onChange={(e) => updateExperience(i, { title: e.target.value })} />
                <Field label="Company" value={exp.company} onChange={(e) => updateExperience(i, { company: e.target.value })} />
                <Field label="Dates" value={exp.dates} onChange={(e) => updateExperience(i, { dates: e.target.value })} />
                <div className="field">
                  <label htmlFor={`bullets-${i}`}>Bullets (one per line)</label>
                  <textarea
                    id={`bullets-${i}`}
                    rows={4}
                    value={exp.bullets.join('\n')}
                    onChange={(e) => updateExperience(i, { bullets: e.target.value.split('\n') })}
                  />
                </div>
                <Button variant="danger" onClick={() => removeExperience(i)}>Remove</Button>
              </Card>
            ))}
            <Button
              variant="secondary"
              onClick={() => setContent((c) => ({ ...c, experience: [...c.experience, { ...emptyExperience }] }))}
            >
              + Add role
            </Button>

            <h3 style={{ marginTop: 24, marginBottom: 12 }}>Education</h3>
            {content.education.map((edu, i) => (
              <Card key={i} style={{ marginBottom: 12 }}>
                <Field label="Degree" value={edu.degree} onChange={(e) => updateEducation(i, { degree: e.target.value })} />
                <Field
                  label="Institution"
                  value={edu.institution}
                  onChange={(e) => updateEducation(i, { institution: e.target.value })}
                />
                <Field label="Dates" value={edu.dates} onChange={(e) => updateEducation(i, { dates: e.target.value })} />
                <Button variant="danger" onClick={() => removeEducation(i)}>Remove</Button>
              </Card>
            ))}
            <Button
              variant="secondary"
              onClick={() => setContent((c) => ({ ...c, education: [...c.education, { ...emptyEducation }] }))}
            >
              + Add education
            </Button>

            <div className="field" style={{ marginTop: 24 }}>
              {source === 'profile' && portfolioSkillGroups.length > 0 ? (
                <>
                  <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                    <label style={{ margin: 0 }}>Skills</label>
                    <span style={{ color: skillsOverCount ? 'var(--error)' : 'var(--gray-600)' }}>
                      {skillsCount} of {RESUME_SKILLS_MAX}
                    </span>
                  </div>
                  <p className="meta" style={{ marginTop: 4, marginBottom: 12 }}>
                    Chosen from your portfolio — pick whole categories or individual skills. Anything
                    left unchecked stays on your portfolio; it just won&apos;t appear on this resume.
                  </p>
                  {portfolioSkillGroups.map((group, gi) => {
                    const keys = group.skills.map((s) => skillKey(gi, s));
                    const selectedCount = keys.filter((k) => selectedSkillKeys.has(k)).length;
                    const allSelected = selectedCount === keys.length;
                    const someSelected = selectedCount > 0 && !allSelected;
                    return (
                      <div key={group.category} style={{ marginBottom: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, margin: 0 }}>
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected;
                            }}
                            onChange={() => toggleGroup(gi)}
                          />
                          {group.category} ({group.skills.length})
                        </label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginLeft: 28, marginTop: 6 }}>
                          {group.skills.map((skill) => (
                            <label
                              key={skill}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem', fontWeight: 400, margin: 0 }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedSkillKeys.has(skillKey(gi, skill))}
                                onChange={() => toggleSkill(gi, skill)}
                              />
                              {skill}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  <label htmlFor="skills">
                    Skills (comma-separated) —{' '}
                    <span style={{ color: skillsOverCount ? 'var(--error)' : 'var(--gray-600)' }}>
                      {skillsCount} of {RESUME_SKILLS_MAX}
                    </span>
                  </label>
                  <input
                    id="skills"
                    value={content.skills.join(', ')}
                    onChange={(e) =>
                      setContent({ ...content, skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                    }
                  />
                </>
              )}
              {overLongSkills.length > 0 && (
                <p className="meta" style={{ color: 'var(--error)', marginTop: 4 }}>
                  Too long to read as one skill on the PDF (max {RESUME_SKILL_MAX_LENGTH} characters) — shorten:{' '}
                  {overLongSkills.map((s) => `"${s}"`).join(', ')}
                </p>
              )}
            </div>
            <p className="meta">
              Your verified skill badges are added automatically — no need to list them here.
            </p>

            {limits && (
              <div className="field">
                <label>Template &amp; branding</label>
                {limits.resumeBranding ? (
                  <p className="meta" style={{ margin: 0 }}>
                    Your PDF includes a &quot;Verified by MyAmbii&quot; footer.{' '}
                    <Link href="/upgrade">Premium removes this →</Link>
                  </p>
                ) : (
                  <p className="meta" style={{ margin: 0 }}>
                    Your PDF has no MyAmbii branding — Premium benefit.
                  </p>
                )}
                {/*
                  Deliberately not driven by limits.resumeTemplates here: that
                  field already lists 4 names for Premium in plans.config.ts,
                  but only the default layout is actually implemented today
                  for every tier (see resume-pdf.builder.ts) — showing the
                  raw entitlements value would promise templates that don't
                  functionally exist yet for anyone. This note stays
                  intentionally tier-independent until real templates ship.
                */}
                <p className="meta" style={{ margin: 0 }}>
                  Every plan uses this same layout today — additional templates (compact, academic,
                  ATS-friendly) are planned as a Premium benefit.
                </p>
              </div>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              <Button onClick={generatePdf} disabled={generating || skillsInvalid}>
                {generating ? 'Generating…' : 'Generate PDF →'}
              </Button>
              <Button variant="secondary" onClick={() => setStage('choose')} disabled={generating}>
                Start over
              </Button>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
