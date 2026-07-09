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
import { SegmentedProgress, SegmentedProgressState } from './ui/SegmentedProgress';

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

function journeySubLabel(state: SegmentedProgressState): string {
  if (state === 'done') return 'Complete';
  if (state === 'active') return 'In progress';
  return 'Not started';
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
  // No new field: "first session" is derived entirely from existing signals —
  // nothing built a profile, earned a badge, or applied to anything yet.
  const isFirstSession = !hasProfile && !hasBadge && !hasApplied;

  // Each stage's state falls out of the one before it — the same booleans
  // drive both the stepper and the "next step" card below, so they can never
  // disagree about what the candidate should do next.
  const stage1: SegmentedProgressState = hasProfile ? 'done' : 'active';
  const stage2: SegmentedProgressState = hasBadge ? 'done' : hasProfile ? 'active' : 'upcoming';
  const stage3: SegmentedProgressState = hasApplied ? 'done' : hasBadge ? 'active' : 'upcoming';

  const journeySteps = [
    { label: 'Profile built', subLabel: journeySubLabel(stage1), state: stage1 },
    { label: 'First badge', subLabel: journeySubLabel(stage2), state: stage2 },
    { label: 'Jobs explored', subLabel: journeySubLabel(stage3), state: stage3 },
  ];

  // Never show the raw phone/email as a "name" — greet by fullName once it
  // exists, otherwise a neutral greeting that still distinguishes a brand
  // new visitor from someone returning who just hasn't named themselves yet.
  const greeting = profile.fullName
    ? `Welcome back, ${profile.fullName}`
    : isFirstSession
      ? 'Welcome to SkillProof'
      : 'Welcome back';

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
        <h1 style={{ marginBottom: 16 }}>{greeting}</h1>

        <SegmentedProgress steps={journeySteps} />

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

        <p style={{ marginTop: -8 }}>
          <Link href="/resume">Build a resume PDF from your profile & badges →</Link>
        </p>

        <p className="app-footer-credit">by flair future Intelligence</p>
      </main>
    </>
  );
}
