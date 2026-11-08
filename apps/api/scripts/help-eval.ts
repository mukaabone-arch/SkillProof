/**
 * Runs the help assistant against scripts/help-eval.cases.json with the real
 * model and prints PASS/FAIL per question. Needs ANTHROPIC_API_KEY; costs a
 * few cents per run. Run after editing a guide or the assistant's rules:
 *
 *   ANTHROPIC_API_KEY=... npm run help:eval
 *   npm run help:eval -- --verbose     (prints every answer)
 *
 * A case passes when `covered` matches (if given), one of the expected
 * sections (if any) is among the cited ones, and the answer doesn't match `mustNotMatch`.
 * Language cases (`note`) are printed for a person to check.
 */
import fs from 'fs';
import path from 'path';
import { LlmService } from '../src/llm/llm.service';
import { HELP_GUIDES } from '../src/modules/help-assistant/help-guides.generated';
import { withoutPaidPlanMentions } from '../src/modules/help-assistant/help-guide-parse';

interface Case {
  audience: 'candidate' | 'employer' | 'recruiter';
  platform?: 'web' | 'android' | 'ios';
  question: string;
  /** Omit when either answer is acceptable. */
  covered?: boolean;
  /** One section id, or several where citing any of them is right (a section and its subsection). */
  expectSection?: string | string[];
  mustNotMatch?: string;
  note?: string;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY first.');
    process.exit(1);
  }
  const verbose = process.argv.includes('--verbose');
  const cases: Case[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'help-eval.cases.json'), 'utf8'));
  const llm = new LlmService();
  let failed = 0;

  for (const c of cases) {
    const guide = HELP_GUIDES[c.audience];
    const ios = c.platform === 'ios';
    const res = await llm.answerHelpQuestion({
      audience: c.audience,
      guide: ios ? withoutPaidPlanMentions(guide.markdown) : guide.markdown,
      sectionIds: guide.sections.map((s) => s.id),
      history: [{ role: 'user', content: c.question }],
      noPaidPlans: ios,
    });
    const problems: string[] = [];
    if (c.covered !== undefined && res.covered !== c.covered) problems.push(`covered=${res.covered}, expected ${c.covered}`);
    const expected = c.expectSection === undefined ? [] : ([] as string[]).concat(c.expectSection);
    if (expected.length && !expected.some((id) => res.sectionIds.includes(id))) {
      problems.push(`cited [${res.sectionIds.join(', ')}], expected ${expected.join(' or ')}`);
    }
    if (c.mustNotMatch && new RegExp(c.mustNotMatch, 'i').test(res.answer)) problems.push(`answer matches /${c.mustNotMatch}/`);

    if (problems.length) failed++;
    const tag = problems.length ? 'FAIL' : 'PASS';
    console.log(`${tag}  [${c.audience}${ios ? '/ios' : ''}] ${c.question}${problems.length ? `\n      ${problems.join('; ')}` : ''}`);
    if (c.note) console.log(`      CHECK: ${c.note}`);
    if (verbose || problems.length || c.note) console.log(`      > ${res.answer.replace(/\n/g, '\n        ')}`);
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
