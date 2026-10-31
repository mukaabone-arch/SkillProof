import { buildSkillPlan, jsonStrings, stablePick } from './interview-prep';

describe('buildSkillPlan', () => {
  const skills = [
    { skillId: 'pe', skillName: 'Prompt Engineering', requiredLevel: 'L2' as const, isRequired: true },
    { skillId: 'ev', skillName: 'LLM Evaluation', requiredLevel: 'L1' as const, isRequired: true },
    { skillId: 'ag', skillName: 'Agent Orchestration', requiredLevel: 'L2' as const, isRequired: true },
    { skillId: 'rag', skillName: 'RAG Systems', requiredLevel: 'L1' as const, isRequired: false },
  ];

  it('proves a skill only at or above the required level, and keeps the best badge', () => {
    const { proven, toProbe } = buildSkillPlan(
      skills,
      [
        { skillId: 'pe', level: 'L1', sessionId: null },
        { skillId: 'pe', level: 'L2', sessionId: 's1' },
        { skillId: 'ev', level: 'L1', sessionId: null },
        { skillId: 'ag', level: 'L1', sessionId: null },
      ],
      new Map([['s1', { strengths: ['structured outputs'], gaps: [] }]]),
      new Set(['ag']),
    );
    expect(proven.map((p) => [p.skillId, p.level])).toEqual([['pe', 'L2'], ['ev', 'L1']]);
    expect(proven[0].strengths).toEqual(['structured outputs']);
    expect(toProbe.map((p) => [p.skillId, p.candidateLevel, p.hasSkillCheck, p.isRequired])).toEqual([
      ['ag', 'L1', true, true],
      ['rag', null, false, false],
    ]);
  });
});

describe('jsonStrings', () => {
  it('reads strings or {text} objects and caps the count', () => {
    expect(jsonStrings(['a', { text: 'b' }, 3, 'c'], 2)).toEqual(['a', 'b']);
    expect(jsonStrings({ not: 'an array' }, 2)).toEqual([]);
  });
});

describe('stablePick', () => {
  it('is stable per seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    expect(stablePick(items, 'entry-1', 3)).toEqual(stablePick(items, 'entry-1', 3));
    expect(stablePick(items, 'entry-1', 3)).toHaveLength(3);
  });
});
