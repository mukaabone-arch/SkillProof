'use client';

/**
 * Candidate dashboard hub — the home page after login, replacing the old
 * dev-harness view. Header + journey progress, a single "your next step"
 * suggested action, three glanceable status cards, and the persistent nav.
 * Design: docs/candidate-journey-design-spec.md.
 *
 * Every value here is derived client-side from existing endpoints — no new
 * backend surface. "Jobs explored" is treated as "has ≥1 application"; a
 * page *view* of matched jobs isn't persisted anywhere, so it isn't a signal
 * we can honestly compute.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import CandidateNav from './CandidateNav';

interface SkillClaim {
  id: string;
  status: string;
  skill: { name: string };
  badge: { verifyHash: string } | null;
}

interface Me {
  phone: string | null;
  email: string | null;
  profile: { skillClaims: SkillClaim[] } | null;
}

interface Profile {
  fullName: string | null;
  completeness: number;
}

interface Assessment {
  _count: { questions: number };
}

interface MatchedResponse {
  jobs: { id: string }[];
}

interface MyApplication {
  id: string;
  status: string;
}

interface Props {
  onLoggedOut: () => void;
}

type StepState = 'done' | 'active' | 'upcoming';

function JourneyStep({ label, state }: { label: string; state: StepState }) {
  return (
    <div className={`stepper-item ${state}`}>
      <span className={`check-circle ${state}`}>{state === 'done' ? '✓' : ''}</span>
      {label}
    </div>
  );
}

export default function Dashboard({ onLoggedOut }: Props) {
  const [me, setMe] = useState<Me>();
  const [profile, setProfile] = useState<Profile>();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [matched, setMatched] = useState<MatchedResponse>();
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<Me>('/users/me'),
      api<Profile>('/profiles/me'),
      api<Assessment[]>('/assessments'),
      api<MatchedResponse>('/jobs/matched'),
      api<MyApplication[]>('/applications/me'),
    ])
      .then(([m, p, a, j, apps]) => {
        setMe(m);
        setProfile(p);
        setAssessments(a);
        setMatched(j);
        setApplications(apps);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <>
        <CandidateNav onLoggedOut={onLoggedOut} />
        <main className="hub">
          <p className="error">{error}</p>
        </main>
      </>
    );
  }
  if (!me || !profile || !matched) {
    return (
      <>
        <CandidateNav onLoggedOut={onLoggedOut} />
        <main className="hub">
          <p>Loading your dashboard…</p>
        </main>
      </>
    );
  }

  const claims = me.profile?.skillClaims ?? [];
  const badges = claims.filter((c) => c.status === 'VERIFIED' && c.badge);
  const liveAssessmentCount = assessments.filter((a) => a._count.questions > 0).length;
  const matchCount = matched.jobs.length;

  const hasProfile = profile.completeness > 0;
  const hasBadge = badges.length > 0;
  const hasApplied = applications.length > 0;

  // Each stage's state falls out of the one before it — the same booleans
  // drive both the stepper and the "next step" card below, so they can never
  // disagree about what the candidate should do next.
  const stage1: StepState = hasProfile ? 'done' : 'active';
  const stage2: StepState = hasBadge ? 'done' : hasProfile ? 'active' : 'upcoming';
  const stage3: StepState = hasApplied ? 'done' : hasBadge ? 'active' : 'upcoming';

  const displayName = profile.fullName || me.phone || me.email || 'there';

  let nextStep: { kicker: string; title: string; cta: string; href: string };
  if (!hasProfile) {
    nextStep = {
      kicker: 'Your next step',
      title: "Start by uploading your resume — we'll build your profile for you.",
      cta: 'Upload your resume',
      href: '/profile',
    };
  } else if (!hasBadge) {
    nextStep = {
      kicker: 'Your next step',
      title:
        liveAssessmentCount > 0
          ? 'Prove your skills — take your first assessment and earn a verified badge.'
          : 'Your profile is ready. Check back soon for assessments to take.',
      cta: 'Take an assessment',
      href: '/assessments',
    };
  } else if (!hasApplied) {
    nextStep = {
      kicker: "You're verified",
      title: 'See jobs that now match your verified skills.',
      cta: 'View matched jobs',
      href: '/jobs?tab=matched',
    };
  } else if (matchCount > 0) {
    nextStep = {
      kicker: 'Keep going',
      title: `You have ${matchCount} job match${matchCount === 1 ? '' : 'es'} — check them out.`,
      cta: 'View matches',
      href: '/jobs?tab=matched',
    };
  } else {
    nextStep = {
      kicker: 'Keep going',
      title: 'Earn more badges to unlock more job matches.',
      cta: 'Take another assessment',
      href: '/assessments',
    };
  }

  const statusCounts = applications.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const statusSummary = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status.toLowerCase()}`)
    .join(', ');

  return (
    <>
      <CandidateNav onLoggedOut={onLoggedOut} />
      <main className="hub">
        <h1 style={{ marginBottom: 16 }}>Welcome back, {displayName}</h1>

        <div className="stepper" style={{ marginBottom: 36 }}>
          <JourneyStep label="Profile built" state={stage1} />
          <span className={`stepper-line ${stage1 === 'done' ? 'done' : ''}`} />
          <JourneyStep label="First badge" state={stage2} />
          <span className={`stepper-line ${stage2 === 'done' ? 'done' : ''}`} />
          <JourneyStep label="Jobs explored" state={stage3} />
        </div>

        <div className="next-step-card">
          <span className={`eyebrow ${hasBadge ? 'verified' : ''}`}>{nextStep.kicker}</span>
          <h2 style={{ marginTop: 14, marginBottom: 20, maxWidth: '48ch' }}>{nextStep.title}</h2>
          <Link href={nextStep.href}>
            <button>{nextStep.cta} →</button>
          </Link>
        </div>

        <div className="status-grid">
          <Link href="/profile" className="status-card">
            <div className="status-card-label">Profile</div>
            <div className="status-stat">{profile.completeness}%</div>
            <div className="meta">
              {profile.completeness < 100 ? 'Complete your profile to stand out.' : 'Your profile is complete.'}
            </div>
          </Link>

          <Link href="/assessments" className="status-card">
            <div className="status-card-label">Verified skills</div>
            <div className="status-stat verified">{badges.length}</div>
            {badges.length === 0 ? (
              <div className="meta">Take an assessment to earn your first badge.</div>
            ) : (
              <div className="row" style={{ flexWrap: 'wrap', margin: 0, marginTop: 8 }}>
                {badges.slice(0, 4).map((c) => (
                  <span key={c.id} className="chip">{c.skill.name}</span>
                ))}
              </div>
            )}
          </Link>

          <Link href={hasApplied ? '/jobs?tab=applications' : '/jobs?tab=browse'} className="status-card">
            <div className="status-card-label">Applications</div>
            <div className="status-stat">{applications.length}</div>
            <div className="meta">{hasApplied ? statusSummary : 'Browse jobs to get started.'}</div>
          </Link>
        </div>

        <p className="app-footer-credit">by flair future Intelligence</p>
      </main>
    </>
  );
}
