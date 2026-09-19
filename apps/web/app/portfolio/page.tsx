'use client';

/**
 * The candidate's own portfolio: review/edit the AI-parsed draft, approve
 * it, and choose whether employers can see it. Parsing itself happens once,
 * server-side, at resume-upload time (ProfilesController.uploadResume ->
 * PortfolioService.parseFromResume) — this page only ever reads/edits the
 * stored result, it never triggers a parse itself.
 *
 * The uploaded resume file is the source of truth; this page is a derived,
 * richer view of it (see CandidatePortfolio's own doc comment in
 * schema.prisma) — re-uploading a resume re-parses and un-approves this
 * draft, so every "edit" surface here says so rather than leaving that to
 * discover the hard way.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import PortfolioSections from '@/components/PortfolioSections';
import { Button, Card, ErrorState, Field, LoadingState } from '@/components/ui';
import type { PortfolioContent, PortfolioViewData, VerifiedBadge, VerifiedCertification } from '@/lib/portfolioTypes';
import { emptyPortfolioContent } from '@/lib/portfolioTypes';

interface PortfolioMeResponse {
  hasResume: boolean;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  yearsOfExp: number | null;
  githubUrl: string | null;
  linkedinUrl: string | null;
  content: PortfolioContent | null;
  approvedAt: string | null;
  visibleToEmployers: boolean;
  parsedAt: string | null;
  verifiedBadges: VerifiedBadge[];
  verifiedCertifications: VerifiedCertification[];
}

type Stage = 'loading' | 'no-resume' | 'no-draft' | 'edit';

export default function PortfolioPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [stage, setStage] = useState<Stage>('loading');
  const [data, setData] = useState<PortfolioMeResponse | null>(null);
  const [content, setContent] = useState<PortfolioContent>(emptyPortfolioContent);
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  useEffect(() => {
    const hasToken = !!getToken();
    setLoggedIn(hasToken);
    setReady(true);
    if (hasToken) load();
  }, []);

  async function load() {
    try {
      const res = await api<PortfolioMeResponse>('/portfolio/me');
      setData(res);
      if (!res.hasResume) {
        setStage('no-resume');
      } else if (!res.content) {
        setStage('no-draft');
      } else {
        setContent(res.content);
        setStage('edit');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function saveContent(): Promise<boolean> {
    setSaving(true);
    setError('');
    setSavedMessage('');
    try {
      const res = await api<PortfolioMeResponse>('/portfolio/me', { method: 'PUT', body: JSON.stringify(content) });
      setData(res);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (await saveContent()) setSavedMessage('Saved. Approve below once it reads correctly.');
  }

  async function handleApprove() {
    if (!(await saveContent())) return;
    setSaving(true);
    try {
      const res = await api<PortfolioMeResponse>('/portfolio/me/approve', { method: 'POST' });
      setData(res);
      setSavedMessage('Approved — you can now make it visible to employers below.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleVisibilityToggle(visible: boolean) {
    setError('');
    try {
      const res = await api<PortfolioMeResponse>('/portfolio/me/visibility', {
        method: 'PUT',
        body: JSON.stringify({ visible }),
      });
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function updateExperience(index: number, patch: Partial<PortfolioContent['experience'][number]>) {
    setContent((c) => ({ ...c, experience: c.experience.map((e, i) => (i === index ? { ...e, ...patch } : e)) }));
  }
  function removeExperience(index: number) {
    setContent((c) => ({ ...c, experience: c.experience.filter((_, i) => i !== index) }));
  }
  function updateProject(index: number, patch: Partial<PortfolioContent['projects'][number]>) {
    setContent((c) => ({ ...c, projects: c.projects.map((p, i) => (i === index ? { ...p, ...patch } : p)) }));
  }
  function removeProject(index: number) {
    setContent((c) => ({ ...c, projects: c.projects.filter((_, i) => i !== index) }));
  }
  function updateEducation(index: number, patch: Partial<PortfolioContent['education'][number]>) {
    setContent((c) => ({ ...c, education: c.education.map((e, i) => (i === index ? { ...e, ...patch } : e)) }));
  }
  function removeEducation(index: number) {
    setContent((c) => ({ ...c, education: c.education.filter((_, i) => i !== index) }));
  }
  function updateSkillGroup(index: number, patch: Partial<PortfolioContent['skillGroups'][number]>) {
    setContent((c) => ({ ...c, skillGroups: c.skillGroups.map((g, i) => (i === index ? { ...g, ...patch } : g)) }));
  }
  function removeSkillGroup(index: number) {
    setContent((c) => ({ ...c, skillGroups: c.skillGroups.filter((_, i) => i !== index) }));
  }

  if (!ready) return <main className="container-reading"><p>Loading…</p></main>;

  const previewData: PortfolioViewData | null = data
    ? {
        fullName: data.fullName,
        headline: data.headline,
        location: data.location,
        yearsOfExp: data.yearsOfExp,
        githubUrl: data.githubUrl,
        linkedinUrl: data.linkedinUrl,
        content,
        verifiedBadges: data.verifiedBadges,
        verifiedCertifications: data.verifiedCertifications,
        contact: null,
      }
    : null;

  return (
    <>
      {loggedIn && <CandidateNav onLoggedOut={() => setLoggedIn(false)} />}
      <main className="hub container-reading">
        <h1>Your portfolio</h1>
        <p>
          A richer, shareable view of your experience, skills and projects — built from your
          uploaded resume, alongside it, not instead of it.
        </p>

        {!loggedIn && (
          <ErrorState message={<>You are not logged in — <Link href="/candidate">log in first</Link> to view your portfolio.</>} />
        )}

        {loggedIn && stage === 'loading' && !error && <LoadingState message="Loading your portfolio…" />}
        {loggedIn && error && <ErrorState message={error} />}

        {loggedIn && stage === 'no-resume' && (
          <Card elevated>
            <p>
              Your portfolio is built automatically from your resume — upload one to generate a
              draft. (If you're on the mobile app: resume upload is web-only for now, not
              something you're missing a setting for.)
            </p>
            <Link href="/resume"><Button>Upload a resume →</Button></Link>
          </Card>
        )}

        {loggedIn && stage === 'no-draft' && (
          <Card elevated>
            <p>We couldn't generate a portfolio draft from your resume. Try re-uploading it.</p>
            <Link href="/resume"><Button>Go to resume →</Button></Link>
          </Card>
        )}

        {loggedIn && stage === 'edit' && data && (
          <>
            <Card elevated style={{ marginBottom: 20 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {data.approvedAt ? 'Approved' : 'Draft — not yet approved'}
                  </p>
                  <p className="meta" style={{ margin: 0 }}>
                    {data.approvedAt
                      ? `Reviewed ${new Date(data.approvedAt).toLocaleDateString()}. Editing anything below will un-approve it until you review again.`
                      : "Review the fields below — this was parsed by AI and can get dates, titles or details wrong. Nothing is shown to employers until you approve it."}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? 'Back to editing' : 'Preview →'}
                </Button>
              </div>

              <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={data.visibleToEmployers}
                    onChange={(e) => handleVisibilityToggle(e.target.checked)}
                  />
                  Visible to employers I've engaged with
                </label>
              </div>
              {data.visibleToEmployers && !data.approvedAt && (
                <p className="meta" style={{ margin: '4px 0 0' }}>
                  Not shown yet — approve your draft first.
                </p>
              )}

              {savedMessage && <p className="ok" style={{ marginTop: 12 }}>{savedMessage}</p>}
            </Card>

            {showPreview && previewData ? (
              <PortfolioSections data={previewData} isOwnPortfolio />
            ) : (
              <>
                <Card style={{ marginBottom: 20 }}>
                  <h2 style={{ marginBottom: 12 }}>About</h2>
                  <Field
                    label="Headline"
                    value={content.headline ?? ''}
                    onChange={(e) => setContent((c) => ({ ...c, headline: e.target.value }))}
                  />
                  <div className="field">
                    <label htmlFor="summary">Summary</label>
                    <textarea
                      id="summary"
                      rows={3}
                      value={content.summary ?? ''}
                      onChange={(e) => setContent((c) => ({ ...c, summary: e.target.value }))}
                    />
                  </div>
                </Card>

                <h2 style={{ marginBottom: 12 }}>Experience</h2>
                {content.experience.map((exp, i) => (
                  <Card key={i} style={{ marginBottom: 12 }}>
                    <Field label="Title" value={exp.title} onChange={(e) => updateExperience(i, { title: e.target.value })} />
                    <Field label="Company" value={exp.company} onChange={(e) => updateExperience(i, { company: e.target.value })} />
                    <Field label="Dates" value={exp.dates} onChange={(e) => updateExperience(i, { dates: e.target.value })} />
                    <div className="field">
                      <label htmlFor={`exp-bullets-${i}`}>Bullets (one per line)</label>
                      <textarea
                        id={`exp-bullets-${i}`}
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
                  onClick={() =>
                    setContent((c) => ({
                      ...c,
                      experience: [...c.experience, { title: '', company: '', dates: '', bullets: [''] }],
                    }))
                  }
                >
                  + Add role
                </Button>

                <h2 style={{ margin: '24px 0 12px' }}>Projects</h2>
                {content.projects.map((p, i) => (
                  <Card key={i} style={{ marginBottom: 12 }}>
                    <Field label="Name" value={p.name} onChange={(e) => updateProject(i, { name: e.target.value })} />
                    <div className="field">
                      <label htmlFor={`proj-desc-${i}`}>Description</label>
                      <textarea
                        id={`proj-desc-${i}`}
                        rows={3}
                        value={p.description}
                        onChange={(e) => updateProject(i, { description: e.target.value })}
                      />
                    </div>
                    <Field
                      label="Technologies (comma-separated)"
                      value={p.technologies.join(', ')}
                      onChange={(e) =>
                        updateProject(i, { technologies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                      }
                    />
                    <Field
                      label="URL (optional)"
                      value={p.url ?? ''}
                      onChange={(e) => updateProject(i, { url: e.target.value || null })}
                    />
                    <Button variant="danger" onClick={() => removeProject(i)}>Remove</Button>
                  </Card>
                ))}
                <Button
                  variant="secondary"
                  onClick={() =>
                    setContent((c) => ({
                      ...c,
                      projects: [...c.projects, { name: '', description: '', technologies: [], url: null }],
                    }))
                  }
                >
                  + Add project
                </Button>

                <h2 style={{ margin: '24px 0 12px' }}>Education</h2>
                {content.education.map((edu, i) => (
                  <Card key={i} style={{ marginBottom: 12 }}>
                    <Field label="Institution" value={edu.institution} onChange={(e) => updateEducation(i, { institution: e.target.value })} />
                    <Field label="Degree" value={edu.degree} onChange={(e) => updateEducation(i, { degree: e.target.value })} />
                    <Field label="Dates" value={edu.dates} onChange={(e) => updateEducation(i, { dates: e.target.value })} />
                    <Button variant="danger" onClick={() => removeEducation(i)}>Remove</Button>
                  </Card>
                ))}
                <Button
                  variant="secondary"
                  onClick={() =>
                    setContent((c) => ({ ...c, education: [...c.education, { degree: '', institution: '', dates: '' }] }))
                  }
                >
                  + Add education
                </Button>

                <h2 style={{ margin: '24px 0 12px' }}>Skills (self-reported, from your resume)</h2>
                <p className="meta" style={{ marginTop: -8, marginBottom: 12 }}>
                  Grouped into categories for display. Verified badges are shown separately and
                  automatically — no need to list them here.
                </p>
                {content.skillGroups.map((g, i) => (
                  <Card key={i} style={{ marginBottom: 12 }}>
                    <Field label="Category" value={g.category} onChange={(e) => updateSkillGroup(i, { category: e.target.value })} />
                    <Field
                      label="Skills (comma-separated)"
                      value={g.skills.join(', ')}
                      onChange={(e) =>
                        updateSkillGroup(i, { skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                      }
                    />
                    <Button variant="danger" onClick={() => removeSkillGroup(i)}>Remove</Button>
                  </Card>
                ))}
                <Button
                  variant="secondary"
                  onClick={() => setContent((c) => ({ ...c, skillGroups: [...c.skillGroups, { category: '', skills: [] }] }))}
                >
                  + Add skill group
                </Button>

                <div className="row" style={{ marginTop: 24 }}>
                  <Button onClick={handleApprove} disabled={saving}>
                    {saving ? 'Saving…' : 'Save & approve'}
                  </Button>
                  <Button variant="secondary" onClick={handleSave} disabled={saving}>
                    Save without approving
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
