'use client';

/**
 * Candidate dashboard hub — the home page after login. An AI co-pilot panel
 * leads (one contextual "next move" message computed from the candidate's
 * own verified skills, match scores, skill gaps, and — once they exist —
 * live interview pipelines and pending assessment reviews), then journey
 * progress and status cards. Design: docs/candidate-journey-design-spec.md.
 * Matched jobs are still fetched — the co-pilot's best-match/recurring-gap
 * logic reads them — but the list itself lives only on the Jobs tab's
 * Matched view now, not here.
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
import { timeOfDayGreeting } from '@/lib/greeting';
import CandidateNav from './CandidateNav';
import AdminNav from './AdminNav';
import FeatureStrip from './FeatureStrip';
import { EmptyState, ErrorState, LoadingState } from './ui';
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

/** Mirrors the candidate-facing shape InterviewsService.present returns from GET /interviews/mine — see components/CandidateInterviews.tsx for the fuller version this is a subset of. */
type PipelineStage = 'SHORTLISTED' | 'INVITED' | 'INTERVIEWING' | 'OFFER' | 'HIRED' | 'DECLINED' | 'REJECTED' | 'CLOSED';
type CandidateResponse = 'ACCEPTED' | 'DECLINED' | 'NEGOTIATING';
interface InterviewRound {
  roundNumber: number;
  status: string;
  channel: string | null;
  scheduledAt: string | null;
}
interface Interview {
  id: string;
  orgName: string;
  job: { id: string; title: string } | null;
  stage: PipelineStage;
  currentRound: InterviewRound | null;
  candidateResponse: CandidateResponse | null;
}

/**
 * GET /assessment-sessions/mine — only ever the candidate's single most
 * recent discussion-assessment session (any status), or null; see that
 * endpoint's own doc comment. Only `status` matters here (is it
 * AWAITING_SCORING/AWAITING_REVIEW right now); skill/level aren't part of
 * the payload because this system only assesses one skill/level today
 * (RAG Systems L2 — see DISCUSSION_SKILL_NAME/LEVEL below, and the same
 * hardcoding already done in app/assessments/discussion/[slug]/page.tsx).
 */
interface MineAssessmentSession {
  id: string;
  status: string;
}

interface Props {
  onLoggedOut: () => void;
}

/** A match at or above this score gets the bold indigo "strong" treatment; below it, the muted "developing" one. */
const MATCH_STRONG_THRESHOLD = 65;
/** A missing skill only becomes the co-pilot's headline suggestion once it's blocking at least this many of the candidate's top matches — a single job's gap isn't a pattern worth interrupting for. */
const RECURRING_GAP_MIN_COUNT = 2;
/** See MineAssessmentSession's doc comment — this system only offers one discussion assessment today, so its skill/level are constants, same as the pre-session page's own SKILL_NAME/SKILL_LEVEL. */
const DISCUSSION_SKILL_NAME = 'RAG Systems';
const DISCUSSION_SKILL_LEVEL = 'L2';

function roleLineFor(job: { title: string } | null): string {
  return job ? ` for ${job.title}` : '';
}

/**
 * A discriminated summary of whichever single interview pipeline needs the
 * candidate's attention most, in the same priority order the co-pilot ladder
 * below uses. Resolved once, outside buildCopilotMessage, the same way
 * bestUnapplied/recurringGap already are — keeps the ladder itself a plain
 * sequence of "if this signal is present" branches with no searching of its
 * own. When several pipelines are active simultaneously, only the single
 * most urgent one is ever returned — HIRED beats an awaiting offer beats a
 * pending invite beats an in-progress interview, matching the order a
 * candidate would actually want to hear about them in.
 */
type PipelineAlert =
  | { kind: 'HIRED'; orgName: string; roleLine: string }
  | { kind: 'OFFER'; orgName: string; roleLine: string }
  | { kind: 'INVITED'; orgName: string; roleLine: string }
  | { kind: 'INTERVIEWING'; orgName: string; roleLine: string; round: InterviewRound | null };

function mostUrgentPipelineAlert(interviews: Interview[]): PipelineAlert | undefined {
  const hired = interviews.find((i) => i.stage === 'HIRED');
  if (hired) return { kind: 'HIRED', orgName: hired.orgName, roleLine: roleLineFor(hired.job) };

  // Awaiting specifically means the candidate hasn't responded yet — once
  // they have (candidateResponse set), the entry stays in OFFER stage until
  // the employer records an outcome, but there's nothing left for the
  // candidate to act on, so it no longer belongs in the co-pilot at all.
  const offerAwaiting = interviews.find((i) => i.stage === 'OFFER' && i.candidateResponse === null);
  if (offerAwaiting) return { kind: 'OFFER', orgName: offerAwaiting.orgName, roleLine: roleLineFor(offerAwaiting.job) };

  const invited = interviews.find((i) => i.stage === 'INVITED');
  if (invited) return { kind: 'INVITED', orgName: invited.orgName, roleLine: roleLineFor(invited.job) };

  const interviewing = interviews.find((i) => i.stage === 'INTERVIEWING');
  if (interviewing) {
    return {
      kind: 'INTERVIEWING',
      orgName: interviewing.orgName,
      roleLine: roleLineFor(interviewing.job),
      round: interviewing.currentRound,
    };
  }

  return undefined;
}

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
  pipelineAlert: PipelineAlert | undefined;
  awaitingReviewSession: MineAssessmentSession | undefined;
  bestUnapplied: MatchedJob | undefined;
  recurringGap: { name: string; count: number } | undefined;
  hasApplied: boolean;
  applicationCount: number;
}): CopilotMessage {
  const {
    hasProfile,
    hasBadge,
    liveAssessmentCount,
    pipelineAlert,
    awaitingReviewSession,
    bestUnapplied,
    recurringGap,
    hasApplied,
    applicationCount,
  } = params;

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

  // Live interview-pipeline and pending-review states, most urgent first —
  // all of these outrank match/gap suggestions below, since none of them
  // are "worth a look," they're waiting on the candidate (or, for HIRED,
  // worth a moment of celebration) right now. A candidate can only ever
  // reach any of these with a profile and a badge already in hand (both
  // are apply-time gates — see candidate-jobs.service.ts), so this block
  // structurally can't fire before the two checks above have passed.
  if (pipelineAlert?.kind === 'HIRED') {
    return {
      eyebrow: 'You got the job!',
      message: `${pipelineAlert.orgName} hired you${pipelineAlert.roleLine}. Congratulations — take a moment, you earned it.`,
      ctaLabel: 'View details',
      ctaHref: '/interviews',
    };
  }

  if (pipelineAlert?.kind === 'OFFER') {
    return {
      eyebrow: 'Offer awaiting your response',
      message: `${pipelineAlert.orgName} has extended an offer${pipelineAlert.roleLine}.`,
      ctaLabel: 'Respond',
      ctaHref: '/interviews',
    };
  }

  if (pipelineAlert?.kind === 'INVITED') {
    return {
      eyebrow: 'Interview invitation',
      message: `${pipelineAlert.orgName} invited you to interview${pipelineAlert.roleLine}.`,
      ctaLabel: 'Accept or decline',
      ctaHref: '/interviews',
    };
  }

  if (pipelineAlert?.kind === 'INTERVIEWING') {
    const round = pipelineAlert.round;
    if (round) {
      const channelPart = round.channel ? ` — ${round.channel}` : '';
      const timePart = round.scheduledAt ? `, ${new Date(round.scheduledAt).toLocaleString()}` : '';
      return {
        eyebrow: 'Interview round scheduled',
        message: `Round ${round.roundNumber} at ${pipelineAlert.orgName}${pipelineAlert.roleLine}${channelPart}${timePart}.`,
        ctaLabel: 'View details',
        ctaHref: '/interviews',
      };
    }
    return {
      eyebrow: 'Interviewing',
      message: `You're interviewing at ${pipelineAlert.orgName}${pipelineAlert.roleLine} — they'll schedule your next round soon.`,
      ctaLabel: 'View details',
      ctaHref: '/interviews',
    };
  }

  if (awaitingReviewSession) {
    return {
      eyebrow: 'Assessment awaiting review',
      message: `Your ${DISCUSSION_SKILL_NAME} ${DISCUSSION_SKILL_LEVEL} session is with a reviewer — results typically within a day.`,
      ctaLabel: 'View status',
      ctaHref: `/assessments/discussion/session/${awaitingReviewSession.id}`,
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
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [assessmentSession, setAssessmentSession] = useState<MineAssessmentSession | null>(null);
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
          // Best-effort, same as external-credentials above — a candidate
          // with no interview pipelines yet, or a hiccup fetching them,
          // should never block the rest of the dashboard from rendering.
          api<Interview[]>('/interviews/mine').catch(() => []),
          api<MineAssessmentSession | null>('/assessment-sessions/mine').catch(() => null),
        ]).then(([p, a, j, apps, creds, ivs, session]) => {
          setProfile(p);
          setAssessments(a);
          setMatched(j);
          setApplications(apps);
          setCredentials(creds);
          setInterviews(ivs);
          setAssessmentSession(session);
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  if (me?.role === 'PLATFORM_ADMIN') {
    return (
      <>
        <AdminNav onLoggedOut={onLoggedOut} />
        <main className="hub container-standard">
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
        <main className="hub container-standard">
          <ErrorState message={error} />
        </main>
      </>
    );
  }
  if (!me || !profile || !matched) {
    return (
      <>
        <CandidateNav onLoggedOut={onLoggedOut} />
        <main className="hub container-standard">
          <LoadingState message="Loading your dashboard…" />
        </main>
      </>
    );
  }

  const claims = me.profile?.skillClaims ?? [];
  const badges = claims.filter((c) => c.status === 'VERIFIED' && c.badge);
  // Verified external credentials get their own indigo signal chip — never
  // folded into the green badge count above, since only a Myambii-graded
  // assessment earns that particular color (see .chip / .chip-external in
  // globals.css).
  const verifiedCredentials = credentials.filter((c) => c.verificationState === 'VERIFIED');
  const liveAssessmentCount = assessments.filter((a) => a._count.questions > 0).length;

  const hasProfile = profile.completeness > 0;
  const hasBadge = badges.length > 0;
  const hasApplied = applications.length > 0;
  // A pipeline entry only ever reaches INVITED (or further) once an
  // employer has acted on it — SHORTLISTED alone (the employer merely
  // saved the candidate) isn't "reached interviewing" yet. REJECTED is
  // excluded too: the entry's current stage is all this endpoint carries,
  // not its history, so a REJECTED row can't be told apart from one that
  // was rejected straight out of SHORTLISTED without ever being invited —
  // treating REJECTED as "reached" would overclaim a milestone we can't
  // actually confirm.
  const hasInterviewStage = interviews.some((i) => i.stage !== 'SHORTLISTED' && i.stage !== 'REJECTED');
  const hasHired = interviews.some((i) => i.stage === 'HIRED');
  // No new field: "first session" is derived entirely from existing signals —
  // nothing built a profile, earned a badge, or applied to anything yet.
  const isFirstSession = !hasProfile && !hasBadge && !hasApplied;

  // Each stage's state falls out of the one before it — the same booleans
  // drive both the stepper and the co-pilot panel below, so they can never
  // disagree about what the candidate should do next.
  const stage1: SegmentedProgressState = hasProfile ? 'done' : 'active';
  const stage2: SegmentedProgressState = hasBadge ? 'done' : hasProfile ? 'active' : 'upcoming';
  const stage3: SegmentedProgressState = hasApplied ? 'done' : hasBadge ? 'active' : 'upcoming';
  const stage4: SegmentedProgressState = hasInterviewStage ? 'done' : hasApplied ? 'active' : 'upcoming';
  const stage5: SegmentedProgressState = hasHired ? 'done' : hasInterviewStage ? 'active' : 'upcoming';

  const journeySteps = [
    { label: 'Profile built', subLabel: journeySubLabel(stage1), state: stage1 },
    { label: 'First badge', subLabel: journeySubLabel(stage2), state: stage2 },
    { label: 'Jobs explored', subLabel: journeySubLabel(stage3), state: stage3 },
    { label: 'Interviewing', subLabel: journeySubLabel(stage4), state: stage4 },
    { label: 'Hired', subLabel: journeySubLabel(stage5), state: stage5 },
  ];

  // Never show the raw phone/email as a "name" — greet by fullName once it
  // exists, otherwise a neutral greeting that still distinguishes a brand
  // new visitor from someone returning who just hasn't named themselves yet.
  const greeting = profile.fullName
    ? `${timeOfDayGreeting()}, ${profile.fullName}`
    : isFirstSession
      ? 'Welcome to Myambii'
      : 'Welcome back';

  const sortedMatches = [...matched.jobs].sort((a, b) => b.score - a.score);
  const bestUnapplied = sortedMatches.find((j) => !j.alreadyApplied);

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

  const pipelineAlert = mostUrgentPipelineAlert(interviews);
  const awaitingReviewSession =
    assessmentSession && (assessmentSession.status === 'AWAITING_SCORING' || assessmentSession.status === 'AWAITING_REVIEW')
      ? assessmentSession
      : undefined;

  const copilot = buildCopilotMessage({
    hasProfile,
    hasBadge,
    liveAssessmentCount,
    pipelineAlert,
    awaitingReviewSession,
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
      <main className="hub container-standard">
        <div className="dashboard-hero">
          <div className="dashboard-hero-bg" />
          <div className="dashboard-hero-inner">
            <h1>{greeting}</h1>
            <p className="hub-subhead">Here&apos;s where things stand — and what to do next.</p>
          </div>
        </div>

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
            <div className="progress-track status-card-progress">
              <div className="progress-fill" style={{ width: `${profile.completeness}%` }} />
            </div>
          </Link>

          <Link href="/assessments" className={hasBadge ? 'status-card' : 'status-card status-card-flag'}>
            <div className="status-card-label">Verified skills{hasBadge ? '' : ' · needs attention'}</div>
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

        <p className="hub-resume-link">
          <Link href="/resume">Build a resume PDF from your profile & badges →</Link>
        </p>

        <FeatureStrip />

        <p className="app-footer-credit">by flair future Intelligence</p>
      </main>
    </>
  );
}
