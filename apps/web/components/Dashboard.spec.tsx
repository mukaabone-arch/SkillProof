/**
 * buildCopilotMessage's apply-gate-progress branch — the level-name
 * fallback this exists for (see entitlements.tsx's own comment: the web
 * deploys on merge, the API deploy is manual, so a deployed client can be
 * talking to an API that predates levelNamesHeld/levelNamesRemaining).
 * Pure function, no rendering needed — exported from Dashboard.tsx for
 * exactly this test.
 */
import { buildCopilotMessage } from './Dashboard';
import type { ApplyGate } from '@/lib/entitlements';

/** Every other branch buildCopilotMessage checks first, all turned off, so params reach the applyGateProgress branch under test. */
function baseParams(progress: ApplyGate['progress']) {
  return {
    hasProfile: true,
    hasBadge: true,
    applyGateMet: false,
    applyGateProgress: progress,
    liveAssessmentCount: 0,
    pipelineAlert: undefined,
    awaitingReviewSession: undefined,
    employerInvite: undefined,
    bestUnapplied: undefined,
    recurringGap: undefined,
    hasApplied: false,
    applicationCount: 0,
  };
}

describe('buildCopilotMessage — apply-gate progress', () => {
  const PROGRESS_BASE = { skillId: 's1', skillName: 'RAG Systems', levelsHeld: ['L1'] as const, levelsRemaining: ['L2', 'L3'] as const };

  it('uses the name fields when the API provides them', () => {
    const result = buildCopilotMessage(
      baseParams({
        ...PROGRESS_BASE,
        levelsHeld: [...PROGRESS_BASE.levelsHeld],
        levelsRemaining: [...PROGRESS_BASE.levelsRemaining],
        levelNamesHeld: ['Foundational'],
        levelNamesRemaining: ['Practitioner', 'Advanced'],
      }),
    );

    expect(result.message).toBe('RAG Systems: Foundational earned — Practitioner and Advanced to go before you can apply to jobs.');
  });

  it('renders the same text, derived from the codes, when the name fields are absent — and does not throw', () => {
    // No levelNamesHeld/levelNamesRemaining at all — an API that predates them.
    const result = buildCopilotMessage(
      baseParams({ ...PROGRESS_BASE, levelsHeld: [...PROGRESS_BASE.levelsHeld], levelsRemaining: [...PROGRESS_BASE.levelsRemaining] }),
    );

    expect(result.message).toBe('RAG Systems: Foundational earned — Practitioner and Advanced to go before you can apply to jobs.');
  });

  it('does not throw when only one of the two fields is absent', () => {
    expect(() =>
      buildCopilotMessage(
        baseParams({
          ...PROGRESS_BASE,
          levelsHeld: [...PROGRESS_BASE.levelsHeld],
          levelsRemaining: [...PROGRESS_BASE.levelsRemaining],
          levelNamesHeld: ['Foundational'],
        }),
      ),
    ).not.toThrow();
  });
});
