'use client';

/**
 * AI resume builder — two paths into the same editable review + PDF-generate
 * step: "Improve my resume" (upload → LlmService.improveResume → edit) and
 * "Build from my profile" (skip straight to an empty, hand-editable review —
 * profile + verified badges alone are enough to generate a PDF). Nothing
 * here is ever written back to the candidate's profile; the PDF is a one-off
 * download built server-side from whatever's in the review form at the
 * moment "Generate PDF" is clicked.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, apiBlob, getToken } from '@/lib/api';
import CandidateNav from '@/components/CandidateNav';
import { Button, Card, ErrorState, Field, LoadingState } from '@/components/ui';

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

export default function ResumePage() {
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

  function startFromProfile() {
    setContent(emptyContent);
    setError('');
    setStage('review');
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

  if (!ready) return <main><p>Loading…</p></main>;

  return (
    <>
      {loggedIn && <CandidateNav onLoggedOut={() => setLoggedIn(false)} />}
      <main className="hub">
        <h1>Build your resume</h1>
        <p>Generate a clean, one-page PDF resume — including your verified skill badges.</p>

        {!loggedIn && (
          <p className="error">
            You are not logged in — <Link href="/">log in first</Link> to build a resume.
          </p>
        )}

        {loggedIn && error && <ErrorState message={error} />}

        {loggedIn && stage === 'choose' && (
          <div className="row" style={{ alignItems: 'stretch', margin: 0 }}>
            <Card elevated style={{ flex: 1 }}>
              <h3 style={{ marginBottom: 8 }}>Improve my resume</h3>
              <p className="meta" style={{ marginBottom: 16 }}>
                Upload your resume — Claude rewrites it with stronger bullets and a tighter summary.
                Review and edit everything before downloading.
              </p>
              <Button onClick={() => setStage('upload')}>Improve my resume</Button>
            </Card>
            <Card elevated style={{ flex: 1 }}>
              <h3 style={{ marginBottom: 8 }}>Build from my profile</h3>
              <p className="meta" style={{ marginBottom: 16 }}>
                Generate a resume from your profile and verified skill badges — no upload needed.
              </p>
              <Button variant="secondary" onClick={startFromProfile}>Build from my profile</Button>
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
              <label htmlFor="skills">Skills (comma-separated)</label>
              <input
                id="skills"
                value={content.skills.join(', ')}
                onChange={(e) =>
                  setContent({ ...content, skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
              />
            </div>
            <p className="meta">
              Your verified skill badges are added automatically — no need to list them here.
            </p>

            <div className="row" style={{ marginTop: 12 }}>
              <Button onClick={generatePdf} disabled={generating}>
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
