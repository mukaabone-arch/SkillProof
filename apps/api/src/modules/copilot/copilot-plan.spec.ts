import {
  buildCopilotPlan,
  CopilotSignals,
  CopilotStep,
  EmployerInviteSignal,
  formatDateTime,
  InterviewSignal,
  MatchedJobSignal,
  MAX_PLAN_STEPS,
  mostUrgentInterview,
  findRecurringGap,
  selectEmployerInvite,
} from './copilot-plan';

const NOW = new Date('2026-10-21T06:00:00.000Z');
const TZ = 'Asia/Kolkata';
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

/**
 * The OLD single-message ladder, copied from apps/web/components/Dashboard.tsx
 * (buildCopilotMessage + its helpers) as of 2026-10-21, adapted only to read
 * the same signal shapes. It exists so the parity test below can prove the
 * server port shows exactly what the dashboard showed. Delete it once the web
 * ladder itself is deleted and the plan has diverged on purpose.
 */
function legacyLadder(s: CopilotSignals) {
  const applyGateMet = s.applyGate?.met ?? s.hasBadge;
  const sorted = [...s.matchedJobs].sort((a, b) => b.score - a.score);
  const bestUnapplied = sorted.find((j) => !j.alreadyApplied);
  const gapCounts = new Map<string, number>();
  sorted.slice(0, 5).forEach((j) => j.missing.forEach((m) => gapCounts.set(m.skillName, (gapCounts.get(m.skillName) ?? 0) + 1)));
  let recurringGap: { name: string; count: number } | undefined;
  gapCounts.forEach((count, name) => {
    if (count >= 2 && (!recurringGap || count > recurringGap.count)) recurringGap = { name, count };
  });
  const ivs = s.interviews;
  const hired = ivs.find((i) => i.stage === 'HIRED');
  const offer = ivs.find((i) => i.stage === 'OFFER' && i.candidateResponse === null);
  const invited = ivs.find((i) => i.stage === 'INVITED');
  const interviewing = ivs.find((i) => i.stage === 'INTERVIEWING');
  const role = (j: { title: string } | null) => (j ? ` for ${j.title}` : '');
  const session =
    s.assessmentSession && ['AWAITING_SCORING', 'AWAITING_REVIEW'].includes(s.assessmentSession.status) ? s.assessmentSession : undefined;

  if (hired) return { eyebrow: 'You got the job!', message: `${hired.orgName} hired you${role(hired.job)}. Congratulations — take a moment, you earned it.`, ctaLabel: 'View details', ctaHref: '/interviews' };
  if (offer) return { eyebrow: 'Offer awaiting your response', message: `${offer.orgName} has extended an offer${role(offer.job)}.`, ctaLabel: 'Respond', ctaHref: '/interviews' };
  if (invited) return { eyebrow: 'Interview invitation', message: `${invited.orgName} invited you to interview${role(invited.job)}.`, ctaLabel: 'Accept or decline', ctaHref: '/interviews' };
  if (interviewing) {
    const r = interviewing.currentRound;
    if (r) {
      const ch = r.channel ? ` — ${r.channel}` : '';
      const t = r.scheduledAt ? `, ${formatDateTime(r.scheduledAt, TZ)}` : '';
      return { eyebrow: 'Interview round scheduled', message: `Round ${r.roundNumber} at ${interviewing.orgName}${role(interviewing.job)}${ch}${t}.`, ctaLabel: 'View details', ctaHref: '/interviews' };
    }
    return { eyebrow: 'Interviewing', message: `You're interviewing at ${interviewing.orgName}${role(interviewing.job)} — they'll schedule your next round soon.`, ctaLabel: 'View details', ctaHref: '/interviews' };
  }
  if (session) return { eyebrow: 'Assessment awaiting review', message: 'Your RAG Systems L2 session is with a reviewer — results typically within a day.', ctaLabel: 'View status', ctaHref: `/assessments/discussion/session/${session.id}` };

  const active = s.employerInvites.filter((i) => i.status === 'ACCRUED_PENDING_START' || i.status === 'STARTED');
  const expiredInvite = s.employerInvites.find((i) => i.status === 'EXPIRED_UNBILLED');
  if (active.length > 0 || expiredInvite) {
    const exDays = (e: string | Date) => Math.max(0, Math.ceil((new Date(e).getTime() - NOW.getTime()) / 86_400_000));
    if (active.length === 0) {
      return { eyebrow: 'Assessment expired', message: `${expiredInvite!.organization.name}'s request to verify ${expiredInvite!.skill.name} expired before you started it.`, ctaLabel: 'Request a new invite', ctaHref: '/assessments' };
    }
    const inv = [...active].sort((a, b) => (!a.expiresAt ? 1 : !b.expiresAt ? -1 : new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime()))[0];
    const more = active.length - 1;
    const moreLink = more > 0 ? { label: `${more} more request${more === 1 ? '' : 's'}`, href: '/assessments' } : undefined;
    const org = inv.organization.name;
    const skill = inv.skill.name;
    if (inv.level === null) {
      const started = inv.status === 'STARTED';
      return {
        eyebrow: started ? 'Assessment in progress' : 'Assessment requested',
        message: started ? `Continue verifying ${skill} for ${org} — pick up any level you haven't finished.` : `${org} asked you to verify ${skill} — three levels, any order.`,
        meta: inv.expiresAt && !started ? `start one within ${exDays(inv.expiresAt)} days` : undefined,
        ctaLabel: started ? 'Continue assessment' : 'Start assessment',
        ctaHref: '/assessments',
        moreLink,
      };
    }
    if (inv.status === 'STARTED' && inv.submitted) return { eyebrow: 'Assessment submitted', message: `${org}'s ${skill} assessment is with a reviewer. We'll notify you when scoring completes.`, moreLink };
    if (inv.status === 'STARTED') return { eyebrow: 'Assessment in progress', message: `Pick up where you left off on ${skill} for ${org}.`, meta: inv.startedAt ? 'Started 2 days ago' : undefined, ctaLabel: 'Resume assessment', ctaAction: { kind: 'resume', requestId: inv.id, level: inv.level }, moreLink };
    const parts: string[] = [];
    if (inv.durationMins) parts.push(`~${inv.durationMins} min`);
    if (inv.expiresAt) parts.push(`expires in ${exDays(inv.expiresAt)} days`);
    return { eyebrow: 'Assessment requested', message: `${org} asked you to verify ${skill}.`, meta: parts.length ? parts.join(' · ') : undefined, ctaLabel: 'Start assessment', ctaAction: { kind: 'start', requestId: inv.id, level: inv.level }, moreLink };
  }

  if (!s.hasProfile) return { eyebrow: "Let's get started", message: "Upload your resume and I'll build your profile — that's step one to matching you with roles.", ctaLabel: 'Build your profile', ctaHref: '/profile' };
  if (!applyGateMet) {
    const p = s.applyGate?.progress;
    if (p) return { eyebrow: 'Your next move', message: `${p.skillName}: ${p.levelNamesHeld.join(', ')} earned — ${p.levelNamesRemaining.join(' and ')} to go before you can apply to jobs.`, ctaLabel: 'Continue assessments', ctaHref: '/assessments' };
    return s.liveAssessmentCount > 0
      ? { eyebrow: 'Your next move', message: "You're set up. Take a verified assessment and I'll start matching you to roles that need exactly those skills.", ctaLabel: 'Take an assessment', ctaHref: '/assessments' }
      : { eyebrow: 'Your next move', message: "Your profile is ready — I'll let you know the moment an assessment opens up to verify your skills.", ctaLabel: 'Check assessments', ctaHref: '/assessments' };
  }
  if (bestUnapplied && bestUnapplied.score >= 65) return { eyebrow: 'Strong match found', message: `${bestUnapplied.title} at ${bestUnapplied.orgName} is a ${bestUnapplied.score}% match with your verified skills — this one's worth a look.`, ctaLabel: `View ${bestUnapplied.title}`, ctaHref: `/jobs/${bestUnapplied.id}` };
  if (recurringGap) return { eyebrow: 'Close the gap', message: `You're one skill away from more matches — ${recurringGap.name} shows up as a requirement on ${recurringGap.count} roles you're close to.`, ctaLabel: 'Explore assessments', ctaHref: '/assessments' };
  if (bestUnapplied) return { eyebrow: 'Keep going', message: `Your best match right now is ${bestUnapplied.score}% — still developing. Verifying more skills will move the needle.`, ctaLabel: 'View matches', ctaHref: '/jobs?tab=matched' };
  if (s.applicationCount > 0) return { eyebrow: "You're on your way", message: `You've applied to ${s.applicationCount} role${s.applicationCount === 1 ? '' : 's'}. I'll keep watching for new ones that fit your verified skills.`, ctaLabel: 'View applications', ctaHref: '/jobs?tab=applications' };
  return { eyebrow: 'Keep going', message: 'Earn another verified skill to unlock more job matches.', ctaLabel: 'Take another assessment', ctaHref: '/assessments' };
}

/** steps[0] flattened into the legacy CopilotMessage shape, for comparison. */
function asLegacy(step: CopilotStep) {
  const out: Record<string, unknown> = { eyebrow: step.eyebrow, message: step.message };
  if (step.meta !== undefined) out.meta = step.meta;
  if (step.cta) {
    out.ctaLabel = step.cta.label;
    if (step.cta.kind === 'navigate') out.ctaHref = step.cta.href;
    else out.ctaAction = { kind: step.cta.mode, requestId: step.cta.requestId, level: step.cta.level };
  }
  if (step.moreLink) out.moreLink = { label: step.moreLink.label, href: step.moreLink.href };
  return out;
}

function dropUndefined(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const iv = (p: Partial<InterviewSignal>): InterviewSignal => ({
  orgName: 'Acme',
  job: { id: 'j1', title: 'ML Engineer' },
  stage: 'SHORTLISTED',
  currentRound: null,
  candidateResponse: null,
  ...p,
});

const inv = (p: Partial<EmployerInviteSignal>): EmployerInviteSignal => ({
  id: 'r1',
  level: 'L1',
  status: 'ACCRUED_PENDING_START',
  expiresAt: days(3),
  startedAt: null,
  durationMins: 40,
  skill: { name: 'Prompt Engineering' },
  organization: { name: 'Globex' },
  ...p,
});

const job = (id: string, score: number, missing: string[] = [], alreadyApplied = false): MatchedJobSignal => ({
  id,
  title: `Role ${id}`,
  orgName: 'Initech',
  score,
  alreadyApplied,
  missing: missing.map((m) => ({ skillId: `sk-${m}`, skillName: m })),
});

const base = (p: Partial<CopilotSignals> = {}): CopilotSignals => ({
  hasProfile: true,
  hasBadge: true,
  applyGate: { met: true, progress: null },
  liveAssessmentCount: 1,
  interviews: [],
  assessmentSession: null,
  employerInvites: [],
  matchedJobs: [],
  applicationCount: 0,
  now: NOW,
  timeZone: TZ,
  ...p,
});

const variants = {
  hasProfile: [true, false],
  hasBadge: [true, false],
  applyGate: [
    null,
    { met: true, progress: null },
    { met: false, progress: null },
    { met: false, progress: { skillName: 'RAG Systems', levelNamesHeld: ['Foundational'], levelNamesRemaining: ['Practitioner', 'Advanced'] } },
  ],
  liveAssessmentCount: [0, 2],
  interviews: [
    [],
    [iv({ stage: 'INTERVIEWING' }), iv({ stage: 'HIRED', orgName: 'Hooli' })],
    [iv({ stage: 'OFFER', candidateResponse: null, job: null })],
    [iv({ stage: 'OFFER', candidateResponse: 'ACCEPTED' })],
    [iv({ stage: 'INVITED' })],
    [iv({ stage: 'INTERVIEWING', currentRound: { roundNumber: 2, channel: 'Google Meet', scheduledAt: days(1) } })],
    [iv({ stage: 'INTERVIEWING' })],
  ] as InterviewSignal[][],
  assessmentSession: [null, { id: 's1', status: 'AWAITING_REVIEW' }, { id: 's2', status: 'COMPLETED' }],
  employerInvites: [
    [],
    [inv({})],
    [inv({ status: 'STARTED', startedAt: days(-2) })],
    [inv({ status: 'STARTED', startedAt: days(-2), submitted: true })],
    [inv({ level: null, durationMins: null })],
    [inv({ level: null, status: 'STARTED' })],
    [inv({ status: 'EXPIRED_UNBILLED' })],
    [inv({ id: 'late', expiresAt: days(4) }), inv({ id: 'soon', expiresAt: days(1) }), inv({ id: 'none', expiresAt: null })],
  ] as EmployerInviteSignal[][],
  matchedJobs: [
    [],
    [job('a', 80, ['LangChain']), job('b', 50, ['LangChain'])],
    [job('a', 40)],
    [job('a', 40, ['Vector DBs', 'LangChain']), job('b', 30, ['Vector DBs']), job('c', 20, ['LangChain', 'Vector DBs'])],
    [job('a', 90, [], true)],
  ] as MatchedJobSignal[][],
  applicationCount: [0, 2],
};

function* allCombinations(): Generator<CopilotSignals> {
  for (const hasProfile of variants.hasProfile)
    for (const hasBadge of variants.hasBadge)
      for (const applyGate of variants.applyGate)
        for (const liveAssessmentCount of variants.liveAssessmentCount)
          for (const interviews of variants.interviews)
            for (const assessmentSession of variants.assessmentSession)
              for (const employerInvites of variants.employerInvites)
                for (const matchedJobs of variants.matchedJobs)
                  for (const applicationCount of variants.applicationCount)
                    yield base({ hasProfile, hasBadge, applyGate, liveAssessmentCount, interviews, assessmentSession, employerInvites, matchedJobs, applicationCount });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('buildCopilotPlan — parity with the old dashboard ladder', () => {
  it('steps[0] equals the legacy single message for every combination of signals', () => {
    let checked = 0;
    for (const s of allCombinations()) {
      const plan = buildCopilotPlan(s);
      expect(plan.steps.length).toBeGreaterThanOrEqual(1);
      const actual = dropUndefined(asLegacy(plan.steps[0]));
      const expected = dropUndefined(legacyLadder(s) as Record<string, unknown>);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        // Narrow failure output to the one diverging case instead of 40k lines.
        expect({ signals: s, actual }).toEqual({ signals: s, actual: expected });
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(40_000);
  });
});

describe('buildCopilotPlan — the extra steps', () => {
  it('never returns more than MAX_PLAN_STEPS, and step ids are unique', () => {
    for (const s of allCombinations()) {
      const { steps } = buildCopilotPlan(s);
      expect(steps.length).toBeLessThanOrEqual(MAX_PLAN_STEPS);
      expect(new Set(steps.map((x) => x.id)).size).toBe(steps.length);
    }
  });

  it('a brand-new candidate gets "build profile" then "take an assessment"', () => {
    const { steps } = buildCopilotPlan(base({ hasProfile: false, hasBadge: false, applyGate: { met: false, progress: null } }));
    expect(steps.map((x) => x.id)).toEqual(['profile', 'apply-gate:start']);
  });

  it('an employer invite leads, followed by the onboarding steps it outranks', () => {
    const { steps } = buildCopilotPlan(
      base({ hasProfile: false, hasBadge: false, applyGate: { met: false, progress: null }, employerInvites: [inv({})] }),
    );
    expect(steps.map((x) => x.id)).toEqual(['invite:r1', 'profile', 'apply-gate:start']);
  });

  it('a strong match is followed by the recurring gap that blocks other roles', () => {
    const { steps } = buildCopilotPlan(base({ matchedJobs: [job('a', 80, ['LangChain']), job('b', 50, ['LangChain'])] }));
    expect(steps.map((x) => x.id)).toEqual(['match:a', 'gap:sk-LangChain']);
    expect(steps[1].cta).toMatchObject({ kind: 'navigate', target: 'assessments', skillId: 'sk-LangChain' });
  });

  it('match and gap suggestions are withheld until the candidate can apply', () => {
    const { steps } = buildCopilotPlan(
      base({ applyGate: { met: false, progress: null }, matchedJobs: [job('a', 80, ['X']), job('b', 70, ['X'])] }),
    );
    expect(steps.map((x) => x.id)).toEqual(['apply-gate:start']);
  });

  it('filler messages only appear when nothing else applies', () => {
    expect(buildCopilotPlan(base({ applicationCount: 3 })).steps.map((x) => x.id)).toEqual(['applied']);
    expect(buildCopilotPlan(base()).steps.map((x) => x.id)).toEqual(['keep-going']);
    expect(
      buildCopilotPlan(base({ applicationCount: 3, matchedJobs: [job('a', 80)] })).steps.map((x) => x.id),
    ).toEqual(['match:a']);
  });

  it('a legacy invite carries an executable start/resume CTA', () => {
    const { steps } = buildCopilotPlan(base({ employerInvites: [inv({ status: 'STARTED', startedAt: days(-2) })] }));
    expect(steps[0].cta).toEqual({ kind: 'start_assessment_request', label: 'Resume assessment', mode: 'resume', requestId: 'r1', level: 'L1' });
    expect(steps[0].meta).toBe('Started 2 days ago');
  });

  it('generatedAt is the injected clock, not the wall clock', () => {
    expect(buildCopilotPlan(base()).generatedAt).toBe(NOW.toISOString());
  });
});

describe('selection helpers', () => {
  it('mostUrgentInterview: HIRED > awaiting offer > invited > interviewing', () => {
    expect(mostUrgentInterview([iv({ stage: 'INVITED' }), iv({ stage: 'HIRED' })])?.stage).toBe('HIRED');
    expect(mostUrgentInterview([iv({ stage: 'OFFER', candidateResponse: 'ACCEPTED' })])).toBeUndefined();
  });

  it('selectEmployerInvite: soonest expiry first, null expiry last, counts the rest', () => {
    const sel = selectEmployerInvite([inv({ id: 'none', expiresAt: null }), inv({ id: 'late', expiresAt: days(4) }), inv({ id: 'soon', expiresAt: days(1) })]);
    expect(sel).toMatchObject({ invite: { id: 'soon' }, moreCount: 2, expired: false });
  });

  it('findRecurringGap: needs at least 2 of the top 5, most frequent wins', () => {
    expect(findRecurringGap([job('a', 50, ['X'])])).toBeUndefined();
    expect(findRecurringGap([job('a', 50, ['X', 'Y']), job('b', 40, ['Y']), job('c', 30, ['X', 'Y'])])).toEqual({
      skillId: 'sk-Y',
      skillName: 'Y',
      count: 3,
    });
  });

  it('formatDateTime falls back to Asia/Kolkata for an invalid zone', () => {
    const v = '2026-10-22T04:30:00.000Z';
    expect(formatDateTime(v, 'Not/AZone')).toBe(formatDateTime(v, 'Asia/Kolkata'));
  });
});
