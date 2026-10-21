import { CopilotService } from './copilot.service';

const NOW = new Date('2026-10-21T06:00:00.000Z');

function makeService(over: {
  profile?: { id: string; completeness: number } | null;
  verifiedClaims?: number;
  applications?: number;
  applyGate?: unknown;
  applyGateThrows?: boolean;
  live?: { _count: { questions: number } }[];
  matched?: { jobs: any[] };
  interviews?: any[] | 'throw';
  session?: any;
  invites?: any[] | 'throw';
}) {
  const prisma = {
    candidateProfile: { findUnique: jest.fn(async () => (over.profile === undefined ? { id: 'p1', completeness: 57 } : over.profile)) },
    skillClaim: { count: jest.fn(async () => over.verifiedClaims ?? 0) },
    application: { count: jest.fn(async () => over.applications ?? 0) },
  };
  const badgeResolver = {
    resolveApplyGateProgress: jest.fn(async () => {
      if (over.applyGateThrows) throw new Error('db down');
      return over.applyGate ?? { met: true, progress: null };
    }),
  };
  const candidateJobs = { matched: jest.fn(async () => over.matched ?? { jobs: [] }) };
  const assessments = { listLive: jest.fn(async () => over.live ?? [{ _count: { questions: 10 } }]) };
  const sessions = { getMine: jest.fn(async () => over.session ?? null) };
  const interviews = {
    listMine: jest.fn(async () => {
      if (over.interviews === 'throw') throw new Error('boom');
      return over.interviews ?? [];
    }),
  };
  const assessmentRequests = {
    listForCandidate: jest.fn(async () => {
      if (over.invites === 'throw') throw new Error('boom');
      return over.invites ?? [];
    }),
  };
  const svc = new CopilotService(
    prisma as never,
    badgeResolver as never,
    candidateJobs as never,
    assessments as never,
    sessions as never,
    interviews as never,
    assessmentRequests as never,
  );
  return { svc, prisma, badgeResolver };
}

describe('CopilotService.gatherSignals', () => {
  it('maps every source into signals', async () => {
    const { svc } = makeService({
      verifiedClaims: 2,
      applications: 3,
      applyGate: {
        met: false,
        progress: { skillId: 's', skillName: 'RAG Systems', levelsHeld: ['L1'], levelsRemaining: ['L2', 'L3'], levelNamesHeld: ['Foundational'], levelNamesRemaining: ['Practitioner', 'Advanced'] },
      },
      live: [{ _count: { questions: 5 } }, { _count: { questions: 0 } }],
      matched: { jobs: [{ id: 'j1', title: 'T', orgName: 'O', score: 70, alreadyApplied: false, missing: [{ skillId: 'k', skillName: 'K', requiredLevel: 'L2', verified: false }], matched: [] }] },
      interviews: [{ id: 'e1', orgName: 'Acme', job: null, stage: 'INVITED', currentRound: null, candidateResponse: null }],
      session: { id: 's1', status: 'AWAITING_REVIEW', insufficientProbing: false, retakeAvailableAt: null },
      invites: [{ id: 'r1', level: 'L1', status: 'ACCRUED_PENDING_START', expiresAt: NOW, startedAt: null, durationMins: 30, submitted: false, skill: { name: 'S' }, organization: { name: 'G' } }],
    });

    const s = await svc.gatherSignals('u1', 'Asia/Kolkata', NOW);

    expect(s).toMatchObject({
      hasProfile: true,
      hasBadge: true,
      applicationCount: 3,
      liveAssessmentCount: 1,
      applyGate: { met: false, progress: { skillName: 'RAG Systems', levelNamesHeld: ['Foundational'], levelNamesRemaining: ['Practitioner', 'Advanced'] } },
      assessmentSession: { id: 's1', status: 'AWAITING_REVIEW' },
      interviews: [{ orgName: 'Acme', stage: 'INVITED', job: null, currentRound: null, candidateResponse: null }],
      employerInvites: [{ id: 'r1', level: 'L1', durationMins: 30, skill: { name: 'S' }, organization: { name: 'G' } }],
      matchedJobs: [{ id: 'j1', score: 70, missing: [{ skillId: 'k', skillName: 'K' }] }],
      now: NOW,
      timeZone: 'Asia/Kolkata',
    });
  });

  it('a candidate with no profile row reads as no profile, and nothing is created', async () => {
    const { svc, prisma } = makeService({ profile: null });
    const s = await svc.gatherSignals('u1', undefined, NOW);
    expect(s).toMatchObject({ hasProfile: false, hasBadge: false, applicationCount: 0 });
    expect(prisma.skillClaim.count).not.toHaveBeenCalled();
    expect(prisma.application.count).not.toHaveBeenCalled();
  });

  it('completeness 0 means no profile, same as the dashboard', async () => {
    const { svc } = makeService({ profile: { id: 'p1', completeness: 0 } });
    expect((await svc.gatherSignals('u1', undefined, NOW)).hasProfile).toBe(false);
  });

  it('best-effort sources failing never fail the plan', async () => {
    const { svc } = makeService({ interviews: 'throw', invites: 'throw', applyGateThrows: true });
    const s = await svc.gatherSignals('u1', undefined, NOW);
    expect(s.interviews).toEqual([]);
    expect(s.employerInvites).toEqual([]);
    expect(s.applyGate).toBeNull();
  });
});

describe('CopilotService.getPlan', () => {
  it('returns a plan whose first step comes from the gathered signals', async () => {
    const { svc } = makeService({ profile: { id: 'p1', completeness: 0 }, applyGate: { met: false, progress: null } });
    const plan = await svc.getPlan('u1', undefined, NOW);
    expect(plan.steps[0].id).toBe('profile');
    expect(plan.generatedAt).toBe(NOW.toISOString());
  });
});
