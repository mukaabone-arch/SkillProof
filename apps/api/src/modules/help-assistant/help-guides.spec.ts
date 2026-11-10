import fs from 'fs';
import path from 'path';
import { parseHelpGuide, withoutPaidPlanMentions } from './help-guide-parse';
import { HELP_GUIDES } from './help-guides.generated';
import { guideHash, HelpLibraryMatcher } from './help-library';
import { HELP_LIBRARY } from './help-library.generated';

const DOCS = path.join(__dirname, '..', '..', '..', '..', '..', 'docs');

describe('help-guides.generated.ts', () => {
  // Runs wherever docs/ is checked out next to apps/api (dev machines, CI);
  // the API image itself only ever sees the generated file.
  const files = { candidate: 'candidate-guide.md', employer: 'employer-guide.md', recruiter: 'recruiter-guide.md' } as const;

  it.each(Object.entries(files))('%s matches docs/%s — run `npm run help:sync` after editing a guide', (key, file) => {
    const full = path.join(DOCS, file);
    if (!fs.existsSync(full)) return;
    expect(HELP_GUIDES[key as keyof typeof files]).toEqual(parseHelpGuide(fs.readFileSync(full, 'utf8')));
  });

  it('every guide has linkable sections', () => {
    for (const guide of Object.values(HELP_GUIDES)) {
      expect(guide.sections.length).toBeGreaterThan(3);
      expect(new Set(guide.sections.map((s) => s.id)).size).toBe(guide.sections.length);
    }
  });
});

describe('parseHelpGuide', () => {
  it('drops the title block and collects ## and ### anchors', () => {
    const g = parseHelpGuide('# Title\r\n\r\nIntro\r\n\r\n## One {#one}\r\n\r\nText\r\n\r\n### Sub part {#sub}\r\n\r\n#### Deep {#deep}\r\n');
    expect(g.markdown.startsWith('## One {#one}')).toBe(true);
    expect(g.markdown).not.toContain('\r');
    expect(g.sections).toEqual([
      { id: 'one', label: 'One' },
      { id: 'sub', label: 'Sub part' },
    ]);
  });
});

describe('withoutPaidPlanMentions', () => {
  it('removes paid-plan sentences and list items but keeps everything else', () => {
    const md = [
      '## Free plan limits {#free-limits}',
      '',
      '**Bold lead.** Two attempts per level. A paid plan is coming in early 2027.',
      '- One live session a month',
      '- Unlimited attempts until skill purchases launch',
      '',
      'Premium costs ₹299 a month.',
      '',
      'The employer covers the cost.',
    ].join('\n');
    const out = withoutPaidPlanMentions(md);
    expect(out).toContain('## Free plan limits {#free-limits}');
    expect(out).toContain('**Bold lead.** Two attempts per level.');
    expect(out).toContain('- One live session a month');
    expect(out).toContain('The employer covers the cost.');
    expect(out).not.toMatch(/paid plan|purchases|premium|₹/i);
  });

  it('leaves the real candidate guide free of paid-plan wording', () => {
    expect(withoutPaidPlanMentions(HELP_GUIDES.candidate.markdown)).not.toMatch(/paid plan|premium|purchas|upgrad|₹/i);
  });
});

describe('help-library.generated.ts', () => {
  const entries = Object.entries(HELP_LIBRARY) as [keyof typeof HELP_GUIDES, NonNullable<(typeof HELP_LIBRARY)['candidate']>][];

  it.each(entries.length ? entries : [['(none)', null]] as never)(
    '%s library was built from the current guide (run `npm run help:library` after editing a guide)',
    (audience, lib) => {
      if (!lib) return;
      expect(lib.guideHash).toBe(guideHash(HELP_GUIDES[audience].markdown));
    },
  );

  it('every entry cites real sections and is found by its own question', () => {
    for (const [audience, lib] of entries) {
      const ids = new Set(HELP_GUIDES[audience].sections.map((s) => s.id));
      const matcher = new HelpLibraryMatcher(lib.entries);
      for (const e of lib.entries) {
        expect(e.sectionIds.every((id) => ids.has(id))).toBe(true);
        // Another entry with the same answer winning is fine; a different answer is a clash to fix in review.
        const hit = matcher.match(e.question);
        if (hit) expect(hit.entry.answer).toBe(e.answer);
      }
    }
  });
});
