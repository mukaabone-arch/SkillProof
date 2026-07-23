/**
 * Rule-based follow-up selection — the cheap path that runs before ever
 * considering an LLM call, per this feature's own cost framing ("Minimize
 * inference cost... Follow-up selection should be rule-based where
 * possible"). Checked in a fixed priority order; the first match wins:
 *
 *  1. DETAIL  — answer is short (< MIN_WORDS words): probe for detail.
 *  2. EXAMPLE — no concrete-example marker found: ask for one.
 *  3. OUTCOME — no outcome/result marker found: ask what happened.
 *  4. LLM_CHOICE — the answer passes all three structural checks (decent
 *     length, has example language, has outcome language) but also
 *     contains a hedge ("I don't have a specific example", "not sure",
 *     etc.) — a real, if narrow, case where the structural regex can be
 *     fooled (hedging prose can accidentally contain "action"/"result"-
 *     shaped words while saying nothing). This is the one case deferred to
 *     the model, which can actually read the content instead of pattern-
 *     matching it.
 *  5. NONE — none of the above: the answer looks structurally complete:
 *     no follow-up.
 *
 * Every check here is deliberately loose. A false negative just means the
 * LLM-fallback or a skipped follow-up runs where a rule could have fired —
 * never wrong, just a missed cost saving. A false positive means an extra
 * follow-up question, harmless in a coaching context. Precision is not the
 * design goal; keeping the common cases free of a model call is.
 */
export type FollowUpKind = 'DETAIL' | 'EXAMPLE' | 'OUTCOME' | 'LLM_CHOICE' | 'NONE';

const MIN_WORDS = 40;

const EXAMPLE_MARKERS =
  /\b(i|we)\s+(was|were|did|had|worked|built|led|managed|faced|handled|decided|noticed|realized|started|created|found|fixed|wrote|designed|proposed|convinced|persuaded|resolved|adjusted|pivoted|asked|told|explained|reached out|met with|sat down)\b/i;

const OUTCOME_MARKERS =
  /\b(result(ed)?|so\s+(we|i)|ended up|in the end|ultimately|eventually|as a result|this led to|which (led|resulted)|we\s+(shipped|delivered|launched|saved|reduced|improved|increased)|(delivered|saved|reduced|improved|increased|resolved|fixed|completed|succeeded))\b/i;

const HEDGE_MARKERS =
  /\b(i don'?t have|i'?m not sure|no specific example|can'?t think of|not really applicable|i haven'?t experienced|hard to say|nothing comes to mind)\b/i;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function chooseFollowUp(answer: string): FollowUpKind {
  if (wordCount(answer) < MIN_WORDS) return 'DETAIL';
  if (!EXAMPLE_MARKERS.test(answer)) return 'EXAMPLE';
  if (!OUTCOME_MARKERS.test(answer)) return 'OUTCOME';
  if (HEDGE_MARKERS.test(answer)) return 'LLM_CHOICE';
  return 'NONE';
}

/** Zero-cost, hand-written phrasings for the three rule-based kinds — a
 * follow-up here never needs an LLM call. Two variants each purely so a
 * candidate asking multiple bank questions across BEHAVIORAL doesn't see
 * the exact same sentence twice in one session; `pick` is injectable for
 * deterministic tests. */
const FOLLOWUP_TEMPLATES: Record<Exclude<FollowUpKind, 'LLM_CHOICE' | 'NONE'>, string[]> = {
  DETAIL: [
    'Can you walk me through that in a bit more detail — what exactly did you do, step by step?',
    'Say more about that one — what did actually handling it look like day to day?',
  ],
  EXAMPLE: [
    "Do you have a specific example that shows this — an actual situation, not just in general?",
    'Can you walk me through one particular time this happened, rather than speaking generally?',
  ],
  OUTCOME: [
    'What actually happened in the end — how did it turn out?',
    "And what was the result once you'd done that?",
  ],
};

export function followUpTemplate(kind: Exclude<FollowUpKind, 'LLM_CHOICE' | 'NONE'>, pick: () => number = Math.random): string {
  const variants = FOLLOWUP_TEMPLATES[kind];
  return variants[Math.floor(pick() * variants.length) % variants.length];
}
