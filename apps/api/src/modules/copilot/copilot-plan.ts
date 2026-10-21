/**
 * The candidate co-pilot plan — a server-side port of the ladder that used to
 * live twice, in apps/web/components/Dashboard.tsx (buildCopilotMessage) and
 * in the mobile app's copilot_panel.dart (a simpler, already-drifted copy).
 *
 * Pure: no Prisma, no Nest, no clock reads except `signals.now`. CopilotService
 * gathers the signals; this file only decides what to say. That split is what
 * makes the parity spec next to it possible.
 *
 * Contract: `steps[0]` is ALWAYS exactly what the old single-message ladder
 * would have shown (same eyebrow, message, meta, CTA). Steps 1-2 are the next
 * applicable suggestions in the same priority order — Phase 1 clients render
 * only steps[0]; the multi-step plan card reads the rest.
 */

/** A match at or above this score is "strong" — same value as web's MATCH_STRONG_THRESHOLD and mobile's kMatchStrongThreshold. */
export const MATCH_STRONG_THRESHOLD = 65;
/** A missing skill only becomes a suggestion once it blocks at least this many of the top matches. */
export const RECURRING_GAP_MIN_COUNT = 2;
/** How many of the candidate's top matches are scanned for recurring gaps. */
export const RECURRING_GAP_TOP_N = 5;
/** Max steps returned. */
export const MAX_PLAN_STEPS = 3;
/** See Dashboard.tsx's MineAssessmentSession comment — only one discussion assessment exists today. */
export const DISCUSSION_SKILL_NAME = 'RAG Systems';
export const DISCUSSION_SKILL_LEVEL = 'L2';
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

// ─── Signals (inputs) ────────────────────────────────────────────────────────

export type PipelineStage =
  | 'SHORTLISTED'
  | 'INVITED'
  | 'INTERVIEWING'
  | 'OFFER'
  | 'HIRED'
  | 'DECLINED'
  | 'REJECTED'
  | 'CLOSED';

export interface InterviewSignal {
  orgName: string;
  job: { id: string; title: string } | null;
  stage: PipelineStage;
  currentRound: { roundNumber: number; channel: string | null; scheduledAt: string | Date | null } | null;
  candidateResponse: 'ACCEPTED' | 'DECLINED' | 'NEGOTIATING' | null;
}

export type EmployerInviteStatus =
  | 'ACCRUED_PENDING_START'
  | 'STARTED'
  | 'COMPLETED'
  | 'EXPIRED_UNBILLED'
  | 'ALREADY_BADGED';

export interface EmployerInviteSignal {
  id: string;
  /** null = whole-skill request (2026-09-14 rework). */
  level: string | null;
  status: EmployerInviteStatus;
  expiresAt: string | Date | null;
  startedAt: string | Date | null;
  durationMins?: number | null;
  submitted?: boolean;
  skill: { name: string };
  organization: { name: string };
}

export interface MatchedJobSignal {
  id: string;
  title: string;
  orgName: string;
  score: number;
  alreadyApplied: boolean;
  missing: { skillId: string; skillName: string }[];
}

export interface ApplyGateSignal {
  met: boolean;
  /** Partial progress toward the gate, or null when there is none. */
  progress: { skillName: string; levelNamesHeld: string[]; levelNamesRemaining: string[] } | null;
}

export interface CopilotSignals {
  hasProfile: boolean;
  hasBadge: boolean;
  /** null only if the gate couldn't be resolved — falls back to hasBadge, same as the web dashboard. */
  applyGate: ApplyGateSignal | null;
  liveAssessmentCount: number;
  interviews: InterviewSignal[];
  /** The candidate's most recent discussion session (any status), or null. */
  assessmentSession: { id: string; status: string } | null;
  /** Already sorted most-recent-first (listForCandidate's order). */
  employerInvites: EmployerInviteSignal[];
  matchedJobs: MatchedJobSignal[];
  applicationCount: number;
  now: Date;
  /** IANA zone used to format interview times; defaults to Asia/Kolkata. */
  timeZone?: string;
}

// ─── Plan (output) ───────────────────────────────────────────────────────────

/**
 * Semantic destination, so each client maps it to its own navigation
 * (web: `href`; mobile: tabs/screens) without parsing URLs.
 */
export type CopilotTarget =
  | 'profile'
  | 'assessments'
  | 'assessment_session'
  | 'interviews'
  | 'job'
  | 'jobs_matched'
  | 'jobs_applications';

export type CopilotCta =
  | {
      kind: 'navigate';
      label: string;
      target: CopilotTarget;
      href: string;
      jobId?: string;
      sessionId?: string;
      /** The skill the destination should highlight (mobile Badges uses this). */
      skillId?: string;
    }
  | {
      /** POST /assessment-requests/mine/:requestId/start { level } — idempotent; legacy single-level invites only. */
      kind: 'start_assessment_request';
      label: string;
      mode: 'start' | 'resume';
      requestId: string;
      level: string;
    };

export interface CopilotStep {
  /** Stable per suggestion (e.g. `gap:<skillId>`), so clients can key/animate rows. */
  id: string;
  eyebrow: string;
  message: string;
  meta?: string;
  /** Absent only for "assessment submitted, awaiting scoring" — nothing for the candidate to do. */
  cta?: CopilotCta;
  moreLink?: { label: string; href: string; target: CopilotTarget };
}

export interface CopilotPlan {
  steps: CopilotStep[];
  generatedAt: string;
}

// ─── Helpers (ported 1:1 from Dashboard.tsx) ─────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function toMs(v: string | Date): number {
  return new Date(v).getTime();
}

function expiresInDays(expiresAt: string | Date, now: Date): number {
  return Math.max(0, Math.ceil((toMs(expiresAt) - now.getTime()) / DAY_MS));
}

function startedAgo(startedAt: string | Date, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - toMs(startedAt)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Web used the browser's toLocaleString(); the server formats in the caller's zone instead. */
export function formatDateTime(v: string | Date, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone }).format(new Date(v));
  } catch {
    return new Intl.DateTimeFormat('en-IN', { ...opts, timeZone: DEFAULT_TIME_ZONE }).format(new Date(v));
  }
}

function roleLineFor(job: { title: string } | null): string {
  return job ? ` for ${job.title}` : '';
}

const nav = (
  label: string,
  target: CopilotTarget,
  href: string,
  extra: Partial<Extract<CopilotCta, { kind: 'navigate' }>> = {},
): CopilotCta => ({ kind: 'navigate', label, target, href, ...extra });

// ─── Signal selection ────────────────────────────────────────────────────────

/** HIRED > offer awaiting a response > invited > interviewing — only the single most urgent. */
export function mostUrgentInterview(interviews: InterviewSignal[]): InterviewSignal | undefined {
  return (
    interviews.find((i) => i.stage === 'HIRED') ??
    interviews.find((i) => i.stage === 'OFFER' && i.candidateResponse === null) ??
    interviews.find((i) => i.stage === 'INVITED') ??
    interviews.find((i) => i.stage === 'INTERVIEWING')
  );
}

export interface SelectedEmployerInvite {
  invite: EmployerInviteSignal;
  moreCount: number;
  expired: boolean;
}

/** Soonest-expiring active invite wins; the most recent expired one only when nothing is active. */
export function selectEmployerInvite(invites: EmployerInviteSignal[]): SelectedEmployerInvite | undefined {
  const active = invites.filter((i) => i.status === 'ACCRUED_PENDING_START' || i.status === 'STARTED');
  if (active.length > 0) {
    const soonest = [...active].sort((a, b) => {
      if (!a.expiresAt) return 1;
      if (!b.expiresAt) return -1;
      return toMs(a.expiresAt) - toMs(b.expiresAt);
    })[0];
    return { invite: soonest, moreCount: active.length - 1, expired: false };
  }
  const expired = invites.find((i) => i.status === 'EXPIRED_UNBILLED');
  return expired ? { invite: expired, moreCount: 0, expired: true } : undefined;
}

export interface RecurringGap {
  skillId: string;
  skillName: string;
  count: number;
}

/** Most frequent missing skill across the top matches, once it recurs; first-seen wins ties (same as web). */
export function findRecurringGap(sortedMatches: MatchedJobSignal[]): RecurringGap | undefined {
  const counts = new Map<string, RecurringGap>();
  for (const job of sortedMatches.slice(0, RECURRING_GAP_TOP_N)) {
    for (const m of job.missing) {
      const cur = counts.get(m.skillId);
      counts.set(m.skillId, { skillId: m.skillId, skillName: m.skillName, count: (cur?.count ?? 0) + 1 });
    }
  }
  let best: RecurringGap | undefined;
  counts.forEach((g) => {
    if (g.count >= RECURRING_GAP_MIN_COUNT && (!best || g.count > best.count)) best = g;
  });
  return best;
}

// ─── Step builders ───────────────────────────────────────────────────────────

function interviewStep(i: InterviewSignal, timeZone: string): CopilotStep {
  const roleLine = roleLineFor(i.job);
  const toInterviews = (label: string) => nav(label, 'interviews', '/interviews');
  switch (i.stage) {
    case 'HIRED':
      return {
        id: 'pipeline:hired',
        eyebrow: 'You got the job!',
        message: `${i.orgName} hired you${roleLine}. Congratulations — take a moment, you earned it.`,
        cta: toInterviews('View details'),
      };
    case 'OFFER':
      return {
        id: 'pipeline:offer',
        eyebrow: 'Offer awaiting your response',
        message: `${i.orgName} has extended an offer${roleLine}.`,
        cta: toInterviews('Respond'),
      };
    case 'INVITED':
      return {
        id: 'pipeline:invited',
        eyebrow: 'Interview invitation',
        message: `${i.orgName} invited you to interview${roleLine}.`,
        cta: toInterviews('Accept or decline'),
      };
    default: {
      const round = i.currentRound;
      if (round) {
        const channelPart = round.channel ? ` — ${round.channel}` : '';
        const timePart = round.scheduledAt ? `, ${formatDateTime(round.scheduledAt, timeZone)}` : '';
        return {
          id: 'pipeline:round',
          eyebrow: 'Interview round scheduled',
          message: `Round ${round.roundNumber} at ${i.orgName}${roleLine}${channelPart}${timePart}.`,
          cta: toInterviews('View details'),
        };
      }
      return {
        id: 'pipeline:interviewing',
        eyebrow: 'Interviewing',
        message: `You're interviewing at ${i.orgName}${roleLine} — they'll schedule your next round soon.`,
        cta: toInterviews('View details'),
      };
    }
  }
}

function employerInviteStep(sel: SelectedEmployerInvite, now: Date): CopilotStep {
  const { invite, moreCount, expired } = sel;
  const id = `invite:${invite.id}`;
  const org = invite.organization.name;
  const skill = invite.skill.name;
  const moreLink =
    moreCount > 0
      ? { label: `${moreCount} more request${moreCount === 1 ? '' : 's'}`, href: '/assessments', target: 'assessments' as const }
      : undefined;

  if (expired) {
    return {
      id,
      eyebrow: 'Assessment expired',
      message: `${org}'s request to verify ${skill} expired before you started it.`,
      cta: nav('Request a new invite', 'assessments', '/assessments'),
    };
  }

  if (invite.level === null) {
    const started = invite.status === 'STARTED';
    return {
      id,
      eyebrow: started ? 'Assessment in progress' : 'Assessment requested',
      message: started
        ? `Continue verifying ${skill} for ${org} — pick up any level you haven't finished.`
        : `${org} asked you to verify ${skill} — three levels, any order.`,
      meta: invite.expiresAt && !started ? `start one within ${expiresInDays(invite.expiresAt, now)} days` : undefined,
      cta: nav(started ? 'Continue assessment' : 'Start assessment', 'assessments', '/assessments'),
      moreLink,
    };
  }

  if (invite.status === 'STARTED' && invite.submitted) {
    return {
      id,
      eyebrow: 'Assessment submitted',
      message: `${org}'s ${skill} assessment is with a reviewer. We'll notify you when scoring completes.`,
      moreLink,
    };
  }

  if (invite.status === 'STARTED') {
    return {
      id,
      eyebrow: 'Assessment in progress',
      message: `Pick up where you left off on ${skill} for ${org}.`,
      meta: invite.startedAt ? `Started ${startedAgo(invite.startedAt, now)}` : undefined,
      cta: { kind: 'start_assessment_request', label: 'Resume assessment', mode: 'resume', requestId: invite.id, level: invite.level },
      moreLink,
    };
  }

  const metaParts: string[] = [];
  if (invite.durationMins) metaParts.push(`~${invite.durationMins} min`);
  if (invite.expiresAt) metaParts.push(`expires in ${expiresInDays(invite.expiresAt, now)} days`);
  return {
    id,
    eyebrow: 'Assessment requested',
    message: `${org} asked you to verify ${skill}.`,
    meta: metaParts.length > 0 ? metaParts.join(' · ') : undefined,
    cta: { kind: 'start_assessment_request', label: 'Start assessment', mode: 'start', requestId: invite.id, level: invite.level },
    moreLink,
  };
}

function applyGateStep(gate: ApplyGateSignal | null, liveAssessmentCount: number): CopilotStep {
  const progress = gate?.progress ?? null;
  if (progress) {
    return {
      id: 'apply-gate:progress',
      eyebrow: 'Your next move',
      message: `${progress.skillName}: ${progress.levelNamesHeld.join(', ')} earned — ${progress.levelNamesRemaining.join(' and ')} to go before you can apply to jobs.`,
      cta: nav('Continue assessments', 'assessments', '/assessments'),
    };
  }
  return liveAssessmentCount > 0
    ? {
        id: 'apply-gate:start',
        eyebrow: 'Your next move',
        message: "You're set up. Take a verified assessment and I'll start matching you to roles that need exactly those skills.",
        cta: nav('Take an assessment', 'assessments', '/assessments'),
      }
    : {
        id: 'apply-gate:waiting',
        eyebrow: 'Your next move',
        message: "Your profile is ready — I'll let you know the moment an assessment opens up to verify your skills.",
        cta: nav('Check assessments', 'assessments', '/assessments'),
      };
}

// ─── The plan ────────────────────────────────────────────────────────────────

/** A rule: returns a step when it applies. `filler` rules are only used when nothing else applies. */
interface Rule {
  filler?: boolean;
  build: () => CopilotStep | undefined;
}

export function buildCopilotPlan(s: CopilotSignals): CopilotPlan {
  const timeZone = s.timeZone ?? DEFAULT_TIME_ZONE;
  const applyGateMet = s.applyGate?.met ?? s.hasBadge;
  const sortedMatches = [...s.matchedJobs].sort((a, b) => b.score - a.score);
  const bestUnapplied = sortedMatches.find((j) => !j.alreadyApplied);
  const recurringGap = findRecurringGap(sortedMatches);
  const interview = mostUrgentInterview(s.interviews);
  const awaitingReview =
    s.assessmentSession && (s.assessmentSession.status === 'AWAITING_SCORING' || s.assessmentSession.status === 'AWAITING_REVIEW')
      ? s.assessmentSession
      : undefined;
  const employerInvite = selectEmployerInvite(s.employerInvites);
  // Match/gap suggestions only make sense once the candidate can actually apply.
  const canApply = s.hasProfile && applyGateMet;

  // Same order as the old ladder — the first rule that applies is steps[0].
  const rules: Rule[] = [
    { build: () => (interview ? interviewStep(interview, timeZone) : undefined) },
    {
      build: () =>
        awaitingReview
          ? {
              id: `review:${awaitingReview.id}`,
              eyebrow: 'Assessment awaiting review',
              message: `Your ${DISCUSSION_SKILL_NAME} ${DISCUSSION_SKILL_LEVEL} session is with a reviewer — results typically within a day.`,
              cta: nav('View status', 'assessment_session', `/assessments/discussion/session/${awaitingReview.id}`, {
                sessionId: awaitingReview.id,
              }),
            }
          : undefined,
    },
    { build: () => (employerInvite ? employerInviteStep(employerInvite, s.now) : undefined) },
    {
      build: () =>
        !s.hasProfile
          ? {
              id: 'profile',
              eyebrow: "Let's get started",
              message: "Upload your resume and I'll build your profile — that's step one to matching you with roles.",
              cta: nav('Build your profile', 'profile', '/profile'),
            }
          : undefined,
    },
    // No hasProfile check: when the profile is missing, the rule above already
    // claimed steps[0], so this becomes the natural "then verify a skill" step 2.
    { build: () => (!applyGateMet ? applyGateStep(s.applyGate, s.liveAssessmentCount) : undefined) },
    {
      build: () =>
        canApply && bestUnapplied && bestUnapplied.score >= MATCH_STRONG_THRESHOLD
          ? {
              id: `match:${bestUnapplied.id}`,
              eyebrow: 'Strong match found',
              message: `${bestUnapplied.title} at ${bestUnapplied.orgName} is a ${bestUnapplied.score}% match with your verified skills — this one's worth a look.`,
              cta: nav(`View ${bestUnapplied.title}`, 'job', `/jobs/${bestUnapplied.id}`, { jobId: bestUnapplied.id }),
            }
          : undefined,
    },
    {
      build: () =>
        canApply && recurringGap
          ? {
              id: `gap:${recurringGap.skillId}`,
              eyebrow: 'Close the gap',
              message: `You're one skill away from more matches — ${recurringGap.skillName} shows up as a requirement on ${recurringGap.count} roles you're close to.`,
              cta: nav('Explore assessments', 'assessments', '/assessments', { skillId: recurringGap.skillId }),
            }
          : undefined,
    },
    {
      // Redundant next to a recurring gap (that already says how to improve), so skipped then.
      build: () =>
        canApply && bestUnapplied && bestUnapplied.score < MATCH_STRONG_THRESHOLD && !recurringGap
          ? {
              id: 'matches',
              eyebrow: 'Keep going',
              message: `Your best match right now is ${bestUnapplied.score}% — still developing. Verifying more skills will move the needle.`,
              cta: nav('View matches', 'jobs_matched', '/jobs?tab=matched'),
            }
          : undefined,
    },
    {
      filler: true,
      build: () =>
        s.applicationCount > 0
          ? {
              id: 'applied',
              eyebrow: "You're on your way",
              message: `You've applied to ${s.applicationCount} role${s.applicationCount === 1 ? '' : 's'}. I'll keep watching for new ones that fit your verified skills.`,
              cta: nav('View applications', 'jobs_applications', '/jobs?tab=applications'),
            }
          : undefined,
    },
    {
      filler: true,
      build: () => ({
        id: 'keep-going',
        eyebrow: 'Keep going',
        message: 'Earn another verified skill to unlock more job matches.',
        cta: nav('Take another assessment', 'assessments', '/assessments'),
      }),
    },
  ];

  const steps: CopilotStep[] = [];
  for (const rule of rules) {
    if (steps.length >= MAX_PLAN_STEPS) break;
    if (rule.filler && steps.length > 0) continue;
    const step = rule.build();
    if (step) steps.push(step);
  }

  return { steps, generatedAt: s.now.toISOString() };
}
