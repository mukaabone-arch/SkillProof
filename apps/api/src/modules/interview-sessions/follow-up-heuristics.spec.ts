import { chooseFollowUp, followUpTemplate, wordCount } from './follow-up-heuristics';

const LONG_WITH_EXAMPLE_AND_OUTCOME =
  'I worked on a project where our main client suddenly changed the requirements right before launch. ' +
  'I paused the team, reassessed what actually needed to happen, and reassigned two engineers to the new priority. ' +
  'As a result, we delivered the revised scope on the original deadline with no missed commitments.';

describe('chooseFollowUp', () => {
  it('DETAIL: a short answer under the word threshold', () => {
    expect(chooseFollowUp('I handled it and it worked out fine.')).toBe('DETAIL');
  });

  it('DETAIL: an empty answer', () => {
    expect(chooseFollowUp('   ')).toBe('DETAIL');
  });

  it('EXAMPLE: long enough, but no first-person concrete-action language', () => {
    const answer =
      'Generally speaking, when a project changes direction, the right approach is to stay calm, ' +
      'reassess priorities, communicate clearly with stakeholders, and make sure the team understands ' +
      'why the change is happening so nobody feels blindsided by the shift in plans.';
    expect(wordCount(answer)).toBeGreaterThanOrEqual(40);
    expect(chooseFollowUp(answer)).toBe('EXAMPLE');
  });

  it('OUTCOME: has length and example language, but never says what happened', () => {
    const answer =
      'I was leading a project when the client suddenly changed direction on us. ' +
      'I paused the team, reassessed the new requirements, and reassigned people to the parts that now mattered most, ' +
      'making sure everyone understood why we were shifting focus so nobody felt blindsided.';
    expect(chooseFollowUp(answer)).toBe('OUTCOME');
  });

  it('NONE: a complete answer with length, example language, and a stated outcome', () => {
    expect(chooseFollowUp(LONG_WITH_EXAMPLE_AND_OUTCOME)).toBe('NONE');
  });

  it('LLM_CHOICE: passes the structural checks by accident but hedges content-wise', () => {
    const answer =
      'I don\'t have a specific example of a time like that, but I was the kind of person who would have ' +
      'handled it by assessing the situation and taking whatever action made sense, which would have resulted ' +
      'in things ending up fine eventually, as a result of just staying calm about it.';
    expect(chooseFollowUp(answer)).toBe('LLM_CHOICE');
  });

  it('priority order: shortness wins even when hedge language is also present', () => {
    expect(chooseFollowUp("I don't have a specific example.")).toBe('DETAIL');
  });
});

describe('followUpTemplate', () => {
  it('picks deterministically from the DETAIL variants given a fixed pick()', () => {
    expect(followUpTemplate('DETAIL', () => 0)).toMatch(/detail|day to day/i);
  });

  it('picks a different EXAMPLE variant for a different pick() value', () => {
    const first = followUpTemplate('EXAMPLE', () => 0);
    const second = followUpTemplate('EXAMPLE', () => 0.99);
    expect(first).not.toBe(second);
  });

  it('always returns a non-empty string for OUTCOME', () => {
    expect(followUpTemplate('OUTCOME', () => 0.5).length).toBeGreaterThan(0);
  });
});
