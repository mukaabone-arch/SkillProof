'use client';

/**
 * Candidate dashboard hub — the home page after login. An AI co-pilot panel
 * leads (one contextual "next move" message computed from the candidate's
 * own verified skills, match scores and skill gaps), then journey progress,
 * status cards, and top job matches. Design: docs/candidate-journey-design-spec.md.
 *
 * Every value here is derived client-side from existing endpoints — no new
 * backend surface, including the co-pilot message (buildCopilotMessage
 * below is pure client-side reasoning over data already being fetched for
 * the rest of the page). "Jobs explored" is treated as "has ≥1 application";
 * a page *view* of matched jobs isn't persisted anywhere, so it isn't a
 * signal we can honestly compute.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import CandidateNav from './CandidateNav';
import AdminNav from './AdminNav';
import { EmptyState } from './ui';
import { SegmentedProgress, SegmentedProgressState } from './ui/SegmentedProgress';

interface SkillClaim {
  id: string;
  status: string;
  skill: { name: string };
  badge: { verifyHash: string; verifiedBy: 'TEST' | 'DISCUSSION' } | null;
}

interface Me {
  role: string;
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

interface SkillGap {
  skillId: string;
  skillName: string;
  requiredLevel: string;
  verified: boolean;
}

interface MatchedJob {
  id: string;
  title: string;
  orgName: string;
  score: number;
  missing: SkillGap[];
  alreadyApplied: boolean;
}

interface MatchedResponse {
  jobs: MatchedJob[];
}

interface MyApplication {
  id: string;
  status: string;
}

/** Only the fields the hub's chip row needs — see the fuller shape in app/profile/page.tsx. */
interface ExternalCredential {
  id: string;
  issuer: string;
  name: string | null;
  verificationState: string;
}

interface Props {
  onLoggedOut: () => void;
}

/** A match at or above this score gets the bold indigo "strong" treatment; below it, the muted "developing" one. */
const MATCH_STRONG_THRESHOLD = 65;
/** A missing skill only becomes the co-pilot's headline suggestion once it's blocking at least this many of the candidate's top matches — a single job's gap isn't a pattern worth interrupting for. */
const RECURRING_GAP_MIN_COUNT = 2;

function journeySubLabel(state: SegmentedProgressState): string {
  if (state === 'done') return 'Complete';
  if (state === 'active') return 'In progress';
  return 'Not started';
}

interface CopilotMessage {
  eyebrow: string;
  message: string;
  ctaLabel: string;
  ctaHref: string;
}

/**
 * The dashboard's hero: one contextual message, prioritized like a coach
 * triaging what actually matters right now, using only data already on the
 * page. Each branch below is mutually exclusive and ordered most- to
 * least-urgent, so the candidate never sees two conflicting suggestions.
 */
function buildCopilotMessage(params: {
  hasProfile: boolean;
  hasBadge: boolean;
  liveAssessmentCount: number;
  bestUnapplied: MatchedJob | undefined;
  recurringGap: { name: string; count: number } | undefined;
  hasApplied: boolean;
  applicationCount: number;
}): CopilotMessage {
  const { hasProfile, hasBadge, liveAssessmentCount, bestUnapplied, recurringGap, hasApplied, applicationCount } = params;

  if (!hasProfile) {
    return {
      eyebrow: "Let's get started",
      message: "Upload your resume and I'll build your profile — that's step one to matching you with roles.",
      ctaLabel: 'Build your profile',
      ctaHref: '/profile',
    };
  }

  if (!hasBadge) {
    return liveAssessmentCount > 0
      ? {
          eyebrow: 'Your next move',
          message: "You're set up. Take a verified assessment and I'll start matching you to roles that need exactly those skills.",
          ctaLabel: 'Take an assessment',
          ctaHref: '/assessments',
        }
      : {
          eyebrow: 'Your next move',
          message: "Your profile is ready — I'll let you know the moment an assessment opens up to verify your skills.",
          ctaLabel: 'Check assessments',
          ctaHref: '/assessments',
        };
  }

  if (bestUnapplied && bestUnapplied.score >= MATCH_STRONG_THRESHOLD) {
    return {
      eyebrow: 'Strong match found',
      message: `${bestUnapplied.title} at ${bestUnapplied.orgName} is a ${bestUnapplied.score}% match with your verified skills — this one's worth a look.`,
      ctaLabel: `View ${bestUnapplied.title}`,
      ctaHref: `/jobs/${bestUnapplied.id}`,
    };
  }

  if (recurringGap) {
    return {
      eyebrow: 'Close the gap',
      message: `You're one skill away from more matches — ${recurringGap.name} shows up as a requirement on ${recurringGap.count} roles you're close to.`,
      ctaLabel: 'Explore assessments',
      ctaHref: '/assessments',
    };
  }

  if (bestUnapplied) {
    return {
      eyebrow: 'Keep going',
      message: `Your best match right now is ${bestUnapplied.score}% — still developing. Verifying more skills will move the needle.`,
      ctaLabel: 'View matches',
      ctaHref: '/jobs?tab=matched',
    };
  }

  if (hasApplied) {
    return {
      eyebrow: "You're on your way",
      message: `You've applied to ${applicationCount} role${applicationCount === 1 ? '' : 's'}. I'll keep watching for new ones that fit your verified skills.`,
      ctaLabel: 'View applications',
      ctaHref: '/jobs?tab=applications',
    };
  }

  return {
    eyebrow: 'Keep going',
    message: 'Earn another verified skill to unlock more job matches.',
    ctaLabel: 'Take another assessment',
    ctaHref: '/assessments',
  };
}

export default function Dashboard({ onLoggedOut }: Props) {
  const [me, setMe] = useState<Me>();
  const [profile, setProfile] = useState<Profile>();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [matched, setMatched] = useState<MatchedResponse>();
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [credentials, setCredentials] = useState<ExternalCredential[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    // /users/me first, standalone — the candidate-only endpoints below 403
    // for a PLATFORM_ADMIN account, and we want to detect that role and show
    // the admin fallback instead of a raw "Insufficient permissions" error.
    // (The normal path never reaches this: app/page.tsx already redirects
    // admins to /admin/assessments before this component mounts.)
    api<Me>('/users/me')
      .then((m) => {
        setMe(m);
        if (m.role === 'PLATFORM_ADMIN') return;
        return Promise.all([
          api<Profile>('/profiles/me'),
          api<Assessment[]>('/assessments'),
          api<MatchedResponse>('/jobs/matched'),
          api<MyApplication[]>('/applications/me'),
          api<ExternalCredential[]>('/profiles/me/external-credentials').catch(() => []),
        ]).then(([p, a, j, apps, creds]) => {
          setProfile(p);
          setAssessments(a);
          setMatched(j);
          setApplications(apps);
          setCredentials(creds);
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  if (me?.role === 'PLATFORM_ADMIN') {
    return (
      <>
        <AdminNav onLoggedOut={onLoggedOut} />
        <main className="hub">
          <EmptyState
            message="You're signed in with an admin account — the candidate dashboard isn't meant for admins."
            actionLabel="Go to admin console"
            actionHref="/admin/assessments"
          />
        </main>
      </>
    );
  }

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
  // Verified external credentials get their own indigo signal chip — never
  // folded into the green badge count above, since only a SkillProof-graded
  // assessment earns that particular color (see .chip / .chip-external in
  // globals.css).
  const verifiedCredentials = credentials.filter((c) => c.verificationState === 'VERIFIED');
  const liveAssessmentCount = assessments.filter((a) => a._count.questions > 0).length;

  const hasProfile = profile.completeness > 0;
  const hasBadge = badges.length > 0;
  const hasApplied = applications.length > 0;
  // No new field: "first session" is derived entirely from existing signals —
  // nothing built a profile, earned a badge, or applied to anything yet.
  const isFirstSession = !hasProfile && !hasBadge && !hasApplied;

  // Each stage's state falls out of the one before it — the same booleans
  // drive both the stepper and the co-pilot panel below, so they can never
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

  const sortedMatches = [...matched.jobs].sort((a, b) => b.score - a.score);
  const bestUnapplied = sortedMatches.find((j) => !j.alreadyApplied);
  const topMatches = sortedMatches.slice(0, 3);

  // How often each missing skill blocks a top match — surfaced only once it
  // recurs (RECURRING_GAP_MIN_COUNT), so the co-pilot points at an actual
  // bottleneck rather than one job's idiosyncratic requirement.
  const gapCounts = new Map<string, number>();
  sortedMatches.slice(0, 5).forEach((j) => {
    j.missing.forEach((m) => gapCounts.set(m.skillName, (gapCounts.get(m.skillName) ?? 0) + 1));
  });
  let recurringGap: { name: string; count: number } | undefined;
  gapCounts.forEach((count, name) => {
    if (count >= RECURRING_GAP_MIN_COUNT && (!recurringGap || count > recurringGap.count)) {
      recurringGap = { name, count };
    }
  });

  const copilot = buildCopilotMessage({
    hasProfile,
    hasBadge,
    liveAssessmentCount,
    bestUnapplied,
    recurringGap,
    hasApplied,
    applicationCount: applications.length,
  });

  const statusCounts = applications.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const statusSummary = Object.entries(statusCounts)
    .map(([status, count]) => `${count} ${status.toLowerCase()}`)
    .join(', ');

  const shownBadges = badges.slice(0, 4);
  const shownCredentials = verifiedCredentials.slice(0, Math.max(0, 4 - shownBadges.length));

  return (
    <>
      <CandidateNav onLoggedOut={onLoggedOut} />
      <main className="hub">
        <h1>{greeting}</h1>
        <p className="hub-subhead">Here&apos;s where things stand — and what to do next.</p>

        <SegmentedProgress steps={journeySteps} />

        <section className="copilot-panel">
          <span className="copilot-eyebrow">
            <span className="copilot-eyebrow-dot" />
            {copilot.eyebrow}
          </span>
          <p className="copilot-message">{copilot.message}</p>
          <Link href={copilot.ctaHref}>
            <button className="btn btn-primary copilot-cta">{copilot.ctaLabel} →</button>
          </Link>
        </section>

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
            {shownBadges.length === 0 && shownCredentials.length === 0 ? (
              <div className="meta">Take an assessment to earn your first badge.</div>
            ) : (
              <div className="signal-chip-row">
                {shownBadges.map((c) => (
                  <span
                    key={c.id}
                    className="chip"
                    title={c.badge!.verifiedBy === 'DISCUSSION' ? 'Verified by discussion' : 'Verified by test'}
                  >
                    {c.skill.name} {c.badge!.verifiedBy === 'DISCUSSION' ? '💬' : '✓'}
                  </span>
                ))}
                {shownCredentials.map((c) => (
                  <span key={c.id} className="chip chip-external">{c.name ?? c.issuer}</span>
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

        {topMatches.length > 0 && (
          <section className="hub-section">
            <div className="hub-section-head">
              <h2>Top matches</h2>
              <Link href="/jobs?tab=matched">View all →</Link>
            </div>
            {topMatches.map((j) => {
              const strong = j.score >= MATCH_STRONG_THRESHOLD;
              const topGap = j.missing[0];
              return (
                <Link key={j.id} href={`/jobs/${j.id}`} className="match-card">
                  <div className="match-card-top">
                    <span className="match-card-title">{j.title}</span>
                    <span className={`match-confidence ${strong ? 'strong' : 'weak'}`}>
                      {j.score}% · {strong ? 'Strong match' : 'Developing match'}
                    </span>
                  </div>
                  <div className="match-score-track">
                    <div className={`match-score-fill ${strong ? 'strong' : 'weak'}`} style={{ width: `${j.score}%` }} />
                  </div>
                  <div className="match-card-meta">
                    <span className="meta" style={{ marginBottom: 0 }}>
                      {j.orgName}
                      {j.alreadyApplied ? ' · ✓ Applied' : ''}
                    </span>
                    {topGap && <span className="match-card-gap">Add: {topGap.skillName}</span>}
                  </div>
                </Link>
              );
            })}
          </section>
        )}

        <p className="hub-resume-link">
          <Link href="/resume">Build a resume PDF from your profile & badges →</Link>
        </p>

        <p className="app-footer-credit">by flair future Intelligence</p>
      </main>
    </>
  );
}
