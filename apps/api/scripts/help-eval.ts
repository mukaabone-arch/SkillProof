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
 * Language cases (`note`) are printed for a person to check. A question the
 * pre-built library answers is checked against the library answer (tagged
 * [library]), since that is what users get.
 */
import fs from 'fs';
import path from 'path';
import { LlmService } from '../src/llm/llm.service';
import { HELP_GUIDES } from '../src/modules/help-assistant/help-guides.generated';
import { iosSafeAnswer, mentionsPaidPlans, withoutPaidPlanMentions } from '../src/modules/help-assistant/help-guide-parse';
import { guideHash, HelpLibraryMatcher } from '../src/modules/help-assistant/help-library';
import { HELP_LIBRARY } from '../src/modules/help-assistant/help-library.generated';

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
  const matchers = new Map<string, HelpLibraryMatcher>();
  for (const [audience, lib] of Object.entries(HELP_LIBRARY)) {
    if (lib && lib.guideHash === guideHash(HELP_GUIDES[audience as Case['audience']].markdown)) {
      matchers.set(audience, new HelpLibraryMatcher(lib.entries));
    }
  }
  let failed = 0;
  let fromLibrary = 0;

  for (const c of cases) {
    const guide = HELP_GUIDES[c.audience];
    const ios = c.platform === 'ios';
    const hit = matchers.get(c.audience)?.match(c.question);
    const useLibrary = hit && !(ios && mentionsPaidPlans(hit.entry.answer));
    if (useLibrary) fromLibrary++;
    const raw = useLibrary
      ? { answer: hit.entry.answer, covered: true, sectionIds: hit.entry.sectionIds }
      : await llm.answerHelpQuestion({
      audience: c.audience,
      guide: ios ? withoutPaidPlanMentions(guide.markdown) : guide.markdown,
      sectionIds: guide.sections.map((s) => s.id),
      history: [{ role: 'user', content: c.question }],
      noPaidPlans: ios,
    });
    // Same last-line guard the service applies to iOS answers.
    const res = ios ? iosSafeAnswer(raw) : raw;
    const problems: string[] = [];
    if (c.covered !== undefined && res.covered !== c.covered) problems.push(`covered=${res.covered}, expected ${c.covered}`);
    const expected = c.expectSection === undefined ? [] : ([] as string[]).concat(c.expectSection);
    if (expected.length && !expected.some((id) => res.sectionIds.includes(id))) {
      problems.push(`cited [${res.sectionIds.join(', ')}], expected ${expected.join(' or ')}`);
    }
    if (c.mustNotMatch && new RegExp(c.mustNotMatch, 'i').test(res.answer)) problems.push(`answer matches /${c.mustNotMatch}/`);

    if (problems.length) failed++;
    const tag = problems.length ? 'FAIL' : 'PASS';
    console.log(`${tag}  [${c.audience}${ios ? '/ios' : ''}]${useLibrary ? ' [library]' : ''} ${c.question}${problems.length ? `\n      ${problems.join('; ')}` : ''}`);
    if (c.note) console.log(`      CHECK: ${c.note}`);
    if (verbose || problems.length || c.note) console.log(`      > ${res.answer.replace(/\n/g, '\n        ')}`);
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed · ${fromLibrary} answered from the library`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
