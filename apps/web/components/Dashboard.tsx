'use client';

/**
 * Candidate dashboard hub — the home page after login. A feature strip leads
 * (see FeatureStrip), then an AI co-pilot panel (one contextual "next move"
 * message computed from the candidate's own verified skills, match scores,
 * skill gaps, and — once they exist — live interview pipelines and pending
 * assessment reviews), then status cards. Design: docs/candidate-journey-design-spec.md.
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
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useEntitlements, type ApplyGate } from '@/lib/entitlements';
import { timeOfDayGreeting } from '@/lib/greeting';
import CandidateNav from './CandidateNav';
import AdminNav from './AdminNav';
import FeatureStrip from './FeatureStrip';
import { EmptyState, ErrorState, LoadingState } from './ui';

interface SkillClaim {
  id: string;
  status: string;
  skill: { name: string };
  badge: { verifyHash: string; verifiedBy: 'TEST' | 'DISCUSSION' } | null;
}

interface Me {
  id: string;
  role: string;
  phone: string | null;
  email: string | null;
  profile: { skillClaims: SkillClaim[] } | null;
}

/**
 * Per-person, not global — same reasoning as EmployerDashboard's
 * teamNudgeDismissKey(orgId): a shared browser, or someone with more than
 * one MyAmbii account, shouldn't have dismissing one account's nudge hide
 * it for another.
 */
function linkPromptDismissKey(userId: string): string {
  return `link-identifier-dismissed:${userId}`;
}

interface LinkIdentifierPrompt {
  title: string;
  body: string;
}

/**
 * Three variants, not two — see the account-linking audit this was built
 * from. `/auth/link/{phone,email}/*` (surfaced today only on
 * Profile → Account → "Login methods") already lets a candidate attach
 * whichever identifier they're missing onto their CURRENT account; the gap
 * this card closes is purely discoverability — nobody who signs up one way
 * and later tries a second knows that flow exists, so they end up with a
 * second, empty account instead (verifyOtp only checks phone,
 * verifyCandidateEmailOtp only checks email, OAuth signup only bridges via
 * a provider-verified email match).
 *
 * The third variant (neither phone nor email set) is real, not
 * theoretical: createUserWithIdentity only copies a provider's email onto
 * User.email when that provider itself reports it verified — an OAuth
 * signup where it doesn't (e.g. a GitHub account with no verified email)
 * leaves both columns null, with the Identity row as the only way in. That
 * account is the most fragile of the three (lose access to that one
 * provider and there is no other way in at all), so it gets its own
 * message rather than silently falling into the phone-prompt copy, which
 * would be misleading about what's actually missing — and it deliberately
 * doesn't name a specific provider (Google/GitHub), since /users/me has no
 * way to tell which one it was.
 */
function linkIdentifierPromptFor(me: Me): LinkIdentifierPrompt | null {
  const keepsEverythingTail =
    "keep everything on this account — badges, history and all — instead of creating a second one.";

  if (me.phone && me.email) return null;

  if (me.phone && !me.email) {
    return {
      title: 'Add your email',
      body: `Add your email so you can sign in either way — and ${keepsEverythingTail}`,
    };
  }

  if (me.email && !me.phone) {
    return {
      title: 'Add your phone number',
      body: `Add your phone number so you can sign in either way — and ${keepsEverythingTail}`,
    };
  }

  return {
    title: 'Add a way to sign in',
    body: 'Add an email or phone number so you can still sign in even if you lose access to your current sign-in method.',
  };
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

/**
 * GET /assessment-requests/mine — an employer-triggered assessment request
 * about this candidate. `durationMins` and `submitted` are derived
 * server-side (AssessmentRequestsService.withCandidateProgress) rather than
 * on the raw AssessmentRequest row: `durationMins` resolves the linked
 * TEST/DISCUSSION assessment's expected length, and `submitted` is true
 * only for a STARTED, discussion-format request whose session is sitting
 * with a reviewer (AWAITING_SCORING/AWAITING_REVIEW) — a TEST-format
 * request has no such intermediate state, since grading is synchronous.
 * There is deliberately no job/role field: AssessmentRequest is
 * shortlist-scoped, not job-scoped (a shortlist entry can be job-less), so
 * "for {role}" isn't something this object can honestly carry.
 */
interface EmployerInvite {
  id: string;
  level: string;
  status: 'ACCRUED_PENDING_START' | 'STARTED' | 'COMPLETED' | 'EXPIRED_UNBILLED' | 'ALREADY_BADGED';
  expiresAt: string | null;
  startedAt: string | null;
  durationMins: number | null;
  submitted: boolean;
  skill: { name: string };
  organization: { name: string };
}

function expiresInDays(expiresAt: string): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function startedMinsAgo(startedAt: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000));
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

interface CopilotMessage {
  eyebrow: string;
  message: string;
  /** Status/expiry line under the message — used by the employer-invite variant. */
  meta?: string;
  /** Present for every branch except the employer-invite "submitted, awaiting scoring" one, which has no action for the candidate to take. */
  ctaLabel?: string;
  /** A plain navigation CTA — every branch except the two below. */
  ctaHref?: string;
  /**
   * A CTA that must POST /assessment-requests/mine/:id/start (idempotent —
   * safe to call again for an already-STARTED request) and navigate based
   * on the response, rather than a static link — used by the employer-invite
   * "invited"/"in progress" states. Mutually exclusive with ctaHref.
   */
  ctaAction?: { kind: 'start' | 'resume'; requestId: string };
  /** "{n} more requests" — shown when more than one employer invite is pending. */
  moreLink?: { label: string; href: string };
}

/** The single employer invite the co-pilot banner should surface, plus how many others are pending. */
interface SelectedEmployerInvite {
  invite: EmployerInvite;
  moreCount: number;
  expired: boolean;
}

/**
 * Soonest-expiring active (ACCRUED_PENDING_START/STARTED) invite wins,
 * since that's the one closest to lapsing unbilled; an EXPIRED_UNBILLED one
 * only ever surfaces when there's no active invite left to show instead.
 */
function selectEmployerInvite(invites: EmployerInvite[]): SelectedEmployerInvite | undefined {
  const active = invites.filter((i) => i.status === 'ACCRUED_PENDING_START' || i.status === 'STARTED');
  if (active.length > 0) {
    const soonest = [...active].sort((a, b) => {
      if (!a.expiresAt) return 1;
      if (!b.expiresAt) return -1;
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
    })[0];
    return { invite: soonest, moreCount: active.length - 1, expired: false };
  }

  // listForCandidate is already sorted most-recent-first, so the first
  // EXPIRED_UNBILLED row here is the most recently expired one.
  const expired = invites.find((i) => i.status === 'EXPIRED_UNBILLED');
  return expired ? { invite: expired, moreCount: 0, expired: true } : undefined;
}

function employerInviteCopilotMessage(selection: SelectedEmployerInvite): CopilotMessage {
  const { invite, moreCount, expired } = selection;
  const moreLink =
    moreCount > 0 ? { label: `${moreCount} more request${moreCount === 1 ? '' : 's'}`, href: '/assessments' } : undefined;

  if (expired) {
    return {
      eyebrow: 'Assessment expired',
      message: `${invite.organization.name}'s request to verify ${invite.skill.name} expired before you started it.`,
      ctaLabel: 'Request a new invite',
      ctaHref: '/assessments',
    };
  }

  if (invite.status === 'STARTED' && invite.submitted) {
    return {
      eyebrow: 'Assessment submitted',
      message: `${invite.organization.name}'s ${invite.skill.name} assessment is with a reviewer. We'll notify you when scoring completes.`,
      moreLink,
    };
  }

  if (invite.status === 'STARTED') {
    return {
      eyebrow: 'Assessment in progress',
      message: `Pick up where you left off on ${invite.skill.name} for ${invite.organization.name}.`,
      meta: invite.startedAt ? `Started ${startedMinsAgo(invite.startedAt)} min ago` : undefined,
      ctaLabel: 'Resume assessment',
      ctaAction: { kind: 'resume', requestId: invite.id },
      moreLink,
    };
  }

  const metaParts: string[] = [];
  if (invite.durationMins) metaParts.push(`~${invite.durationMins} min`);
  if (invite.expiresAt) metaParts.push(`expires in ${expiresInDays(invite.expiresAt)} days`);
  return {
    eyebrow: 'Assessment requested',
    message: `${invite.organization.name} asked you to verify ${invite.skill.name}.`,
    meta: metaParts.length > 0 ? metaParts.join(' · ') : undefined,
    ctaLabel: 'Start assessment',
    ctaAction: { kind: 'start', requestId: invite.id },
    moreLink,
  };
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
  /** From useEntitlements().applyGate?.met — the L1-L3-of-one-skill apply gate, not "has any badge at all." Falls back to hasBadge while entitlements are still loading (see call site). */
  applyGateMet: boolean;
  applyGateProgress: ApplyGate['progress'];
  liveAssessmentCount: number;
  pipelineAlert: PipelineAlert | undefined;
  awaitingReviewSession: MineAssessmentSession | undefined;
  employerInvite: SelectedEmployerInvite | undefined;
  bestUnapplied: MatchedJob | undefined;
  recurringGap: { name: string; count: number } | undefined;
  hasApplied: boolean;
  applicationCount: number;
}): CopilotMessage {
  const {
    hasProfile,
    hasBadge,
    applyGateMet,
    applyGateProgress,
    liveAssessmentCount,
    pipelineAlert,
    awaitingReviewSession,
    employerInvite,
    bestUnapplied,
    recurringGap,
    hasApplied,
    applicationCount,
  } = params;

  // Live interview-pipeline and pending-review states, most urgent first —
  // all of these outrank everything below, including the employer-invite
  // and !hasProfile/!applyGateMet branches, since none of them are "worth a
  // look" or "step one," they're waiting on the candidate (or, for HIRED,
  // worth a moment of celebration) right now. A candidate can only ever
  // reach any of these with a profile and the apply gate satisfied already
  // (both are apply-time gates — see candidate-jobs.service.ts's
  // assertProfileReadyToApply/assertMeetsSkillLevelGate), so in practice
  // this block is simply inert (pipelineAlert/awaitingReviewSession both
  // undefined) until hasProfile && applyGateMet are true — evaluating it
  // ahead of those two checks changes nothing for either.
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

  // An actual employer request outranks every suggestion below — including
  // the !hasProfile/!hasBadge onboarding nudges, not just the match/gap
  // ones further down. A brand-new, zero-badge account is exactly who
  // employers most often invite (verifying a skill the candidate doesn't
  // have yet), and starting the linked assessment has no profile gate of
  // its own, so there's no reason to bury a live, expiring invite under a
  // generic "build your profile" nudge.
  if (employerInvite) {
    return employerInviteCopilotMessage(employerInvite);
  }

  if (!hasProfile) {
    return {
      eyebrow: "Let's get started",
      message: "Upload your resume and I'll build your profile — that's step one to matching you with roles.",
      ctaLabel: 'Build your profile',
      ctaHref: '/profile',
    };
  }

  if (!applyGateMet) {
    // Partial progress toward the gate (e.g. L1 earned, L2/L3 still to go)
    // gets its own specific message, distinct from "nothing yet" — a
    // candidate who's already invested in a skill shouldn't be told to
    // "take an assessment" as if starting from zero.
    if (applyGateProgress) {
      const remaining = applyGateProgress.levelsRemaining.join(' and ');
      return {
        eyebrow: 'Your next move',
        message: `${applyGateProgress.skillName}: ${applyGateProgress.levelsHeld.join(', ')} earned — ${remaining} to go before you can apply to jobs.`,
        ctaLabel: 'Continue assessments',
        ctaHref: '/assessments',
      };
    }
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
  const router = useRouter();
  const { applyGate } = useEntitlements();
  const [me, setMe] = useState<Me>();
  const [profile, setProfile] = useState<Profile>();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [matched, setMatched] = useState<MatchedResponse>();
  const [applications, setApplications] = useState<MyApplication[]>([]);
  const [credentials, setCredentials] = useState<ExternalCredential[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [assessmentSession, setAssessmentSession] = useState<MineAssessmentSession | null>(null);
  const [employerInvites, setEmployerInvites] = useState<EmployerInvite[]>([]);
  const [startingInviteId, setStartingInviteId] = useState<string | null>(null);
  const [inviteActionError, setInviteActionError] = useState('');
  const [error, setError] = useState('');
  const [linkPromptDismissed, setLinkPromptDismissed] = useState(false);

  // Start (ACCRUED_PENDING_START) or resume (STARTED) an employer-triggered
  // request — same POST either way (idempotent server-side, see
  // AssessmentRequestsService.startFromRequest) and same
  // navigate-into-the-existing-take-flow response shape EmployerInvitations
  // already uses on /assessments; duplicated here rather than shared since
  // it's ten lines and the two components have no natural common module.
  async function startOrResumeInvite(requestId: string) {
    setInviteActionError('');
    setStartingInviteId(requestId);
    try {
      const result = await api<{ attemptId: string | null; sessionId: string | null; assessmentId: string | null }>(
        `/assessment-requests/mine/${requestId}/start`,
        { method: 'POST' },
      );
      if (result.assessmentId) {
        router.push(`/assessments/${result.assessmentId}`);
      } else if (result.sessionId) {
        router.push(`/assessments/discussion/session/${result.sessionId}`);
      } else {
        setInviteActionError('Could not start this assessment — please try again.');
        setStartingInviteId(null);
      }
    } catch (e) {
      setInviteActionError((e as Error).message);
      setStartingInviteId(null);
    }
  }

  // Read once `me.id` is known — localStorage isn't available during server
  // rendering, same reasoning as EmployerDashboard's identical read for its
  // team-invite nudge.
  useEffect(() => {
    if (!me) return;
    setLinkPromptDismissed(localStorage.getItem(linkPromptDismissKey(me.id)) === '1');
  }, [me?.id]);

  function dismissLinkPrompt() {
    if (!me) return;
    localStorage.setItem(linkPromptDismissKey(me.id), '1');
    setLinkPromptDismissed(true);
  }

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
          api<EmployerInvite[]>('/assessment-requests/mine').catch(() => []),
        ]).then(([p, a, j, apps, creds, ivs, session, invites]) => {
          setProfile(p);
          setAssessments(a);
          setMatched(j);
          setApplications(apps);
          setCredentials(creds);
          setInterviews(ivs);
          setAssessmentSession(session);
          setEmployerInvites(invites);
        });
      })
      .catch((e) => {
        // app/candidate/page.tsx's resolveRole() only ever renders this
        // component for a confirmed-complete candidate (or a non-candidate
        // role), so a rejection here is a genuine, worth-logging failure —
        // never CANDIDATE_VERIFICATION_INCOMPLETE, which resolveRole
        // already screened out before Dashboard could mount.
        console.error('Dashboard: unexpected failure loading candidate data', e);
        setError(e.message);
      });
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
  // folded into the green badge count above, since only a MyAmbii-graded
  // assessment earns that particular color (see .chip / .chip-external in
  // globals.css).
  const verifiedCredentials = credentials.filter((c) => c.verificationState === 'VERIFIED');
  const liveAssessmentCount = assessments.filter((a) => a._count.questions > 0).length;

  const hasProfile = profile.completeness > 0;
  const hasBadge = badges.length > 0;
  // Falls back to the coarser hasBadge signal while entitlements are still
  // loading (applyGate null) so the co-pilot ladder doesn't flash a "no
  // progress" message for a candidate who actually has some — refines to
  // the real L1-L3-of-one-skill gate the moment the fetch resolves.
  const applyGateMet = applyGate?.met ?? hasBadge;
  const applyGateProgress = applyGate?.progress ?? null;
  const hasApplied = applications.length > 0;
  // No new field: "first session" is derived entirely from existing signals —
  // nothing built a profile, earned a badge, or applied to anything yet.
  const isFirstSession = !hasProfile && !hasBadge && !hasApplied;

  // Never show the raw phone/email as a "name" — greet by fullName once it
  // exists, otherwise a neutral greeting that still distinguishes a brand
  // new visitor from someone returning who just hasn't named themselves yet.
  // Both nameless branches are time-of-day based, same as the named branch —
  // mirrors skillproof-mobile's identical change to greeting.dart +
  // hero_section.dart, kept in step deliberately so the two platforms never
  // show different copy for the same state.
  const greeting = profile.fullName
    ? `${timeOfDayGreeting()}, ${profile.fullName}`
    : isFirstSession
      ? `${timeOfDayGreeting()} — welcome to MyAmbii`
      : `${timeOfDayGreeting()} — welcome back`;

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
  const employerInvite = selectEmployerInvite(employerInvites);
  // "Outstanding" for the stepper specifically means still-actionable
  // (invited or in progress) — an EXPIRED_UNBILLED invite still surfaces in
  // the banner (so the candidate knows what happened) but shouldn't claim
  // "Verify skills" is where they're headed next.
  const hasOutstandingEmployerInvite = !!employerInvite && !employerInvite.expired;

  const copilot = buildCopilotMessage({
    hasProfile,
    hasBadge,
    applyGateMet,
    applyGateProgress,
    liveAssessmentCount,
    pipelineAlert,
    awaitingReviewSession,
    employerInvite,
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

  const linkPrompt = linkIdentifierPromptFor(me);

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

        <FeatureStrip activeStage={hasOutstandingEmployerInvite ? 'Verify skills' : undefined} />

        {linkPrompt && !linkPromptDismissed && (
          <div
            className="card status-card-flag"
            style={{ justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}
          >
            <div>
              <strong>{linkPrompt.title}</strong>
              <p className="meta" style={{ margin: 0 }}>{linkPrompt.body}</p>
            </div>
            <div className="row" style={{ margin: 0, alignItems: 'center', gap: 8 }}>
              <Link href="/profile/account#login-methods">
                <button className="btn-secondary">Add now →</button>
              </Link>
              <button className="btn-secondary" onClick={dismissLinkPrompt}>Dismiss</button>
            </div>
          </div>
        )}

        <section className="copilot-panel">
          <span className="copilot-eyebrow">
            <span className="copilot-eyebrow-dot" />
            {copilot.eyebrow}
          </span>
          <p className="copilot-message">{copilot.message}</p>
          {copilot.meta && <p className="copilot-meta">{copilot.meta}</p>}
          {copilot.ctaAction ? (
            <button
              type="button"
              className="btn btn-primary copilot-cta"
              onClick={() => startOrResumeInvite(copilot.ctaAction!.requestId)}
              disabled={startingInviteId === copilot.ctaAction.requestId}
            >
              {startingInviteId === copilot.ctaAction.requestId ? 'Starting…' : `${copilot.ctaLabel} →`}
            </button>
          ) : (
            copilot.ctaHref &&
            copilot.ctaLabel && (
              <Link href={copilot.ctaHref}>
                <button className="btn btn-primary copilot-cta">{copilot.ctaLabel} →</button>
              </Link>
            )
          )}
          {copilot.moreLink && (
            <Link href={copilot.moreLink.href} className="copilot-more">
              {copilot.moreLink.label} →
            </Link>
          )}
          {inviteActionError && <p className="error">{inviteActionError}</p>}
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

        <p className="app-footer-credit">by flair future Intelligence</p>
      </main>
    </>
  );
}
