import { EmploymentType, SkillLevel } from '@prisma/client';
import { mapHeaders, parseCsv, parseSkills, postingBlockers, templateCsv, toImportRow } from './job-csv';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and line breaks inside quotes, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n,,\r\n';
    expect(parseCsv(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2'],
    ]);
  });

  it('keeps a last row with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('mapHeaders', () => {
  it('matches headers loosely and reports missing required ones', () => {
    const { columns, missing, unknown } = mapHeaders(['Job_Title', 'JD', 'Location', 'Notes']);
    expect([...columns.values()]).toEqual(['title', 'description', 'location']);
    expect(missing).toEqual(['employment type']);
    expect(unknown).toEqual(['Notes']);
  });
});

describe('parseSkills', () => {
  it('reads names, levels in either form, and optional skills', () => {
    const warnings: string[] = [];
    expect(parseSkills('RAG Systems: L2; Prompt Engineering: Foundational (optional); Vector Stores', warnings)).toEqual([
      { name: 'RAG Systems', level: SkillLevel.L2, isRequired: true },
      { name: 'Prompt Engineering', level: SkillLevel.L1, isRequired: false },
      { name: 'Vector Stores', level: SkillLevel.L1, isRequired: true },
    ]);
    expect(warnings).toEqual([]);
  });

  it('warns on an unknown level and falls back to L1', () => {
    const warnings: string[] = [];
    expect(parseSkills('LLM Evaluation: guru', warnings)[0].level).toBe(SkillLevel.L1);
    expect(warnings[0]).toMatch(/Unknown level "guru"/);
  });
});

describe('toImportRow', () => {
  const header = mapHeaders(parseCsv(templateCsv())[0]).columns;
  const row = (over: Record<number, string>) => {
    const cells = parseCsv(templateCsv())[1].slice();
    for (const [i, v] of Object.entries(over)) cells[Number(i)] = v;
    return toImportRow(cells, header, 1);
  };

  it('reads the template example cleanly', () => {
    const r = row({});
    expect(r.errors).toEqual([]);
    expect(r).toMatchObject({
      code: 'AI-001',
      title: 'Senior ML Engineer',
      employmentType: EmploymentType.FULL_TIME,
      location: 'Bengaluru, India',
      remote: false,
      experienceMin: 4,
      experienceMax: 8,
      salaryMinPaise: 30 * 100_000 * 100,
      salaryMaxPaise: 45 * 100_000 * 100,
    });
    expect(r.skills.map((s) => s.name)).toEqual(['RAG Systems', 'Prompt Engineering']);
  });

  it('collects errors for missing or invalid required fields', () => {
    const r = row({ 1: '', 2: 'short', 3: 'Gig' });
    expect(r.errors).toEqual([
      'Title is missing.',
      'Description is missing or shorter than 20 characters.',
      'Employment type "Gig" isn\'t one of Full-time, Part-time, Contract or Internship.',
    ]);
  });

  it('accepts common spellings of employment type', () => {
    expect(row({ 3: 'part-time' }).employmentType).toBe(EmploymentType.PART_TIME);
    expect(row({ 3: 'Intern' }).employmentType).toBe(EmploymentType.INTERNSHIP);
  });

  it('rejects inverted ranges and bad codes', () => {
    expect(row({ 6: '9', 7: '3' }).errors).toContain('Experience min is more than experience max.');
    expect(row({ 8: '50', 9: '20' }).errors).toContain('Salary min is more than salary max.');
    expect(row({ 0: 'AI 001' }).errors[0]).toMatch(/Code may only contain/);
  });

  it('drops salary numbers when marked not disclosed, with a warning', () => {
    const r = row({ 10: 'yes' });
    expect(r.salaryMinPaise).toBeNull();
    expect(r.salaryNotDisclosed).toBe(true);
    expect(r.warnings[0]).toMatch(/not disclosed/);
  });
});

describe('postingBlockers', () => {
  it('needs a required skill and a city or remote', () => {
    expect(postingBlockers({ remote: false, locationCity: null, skills: [] })).toHaveLength(2);
    expect(postingBlockers({ remote: true, locationCity: null, skills: [{ isRequired: true }] })).toEqual([]);
    expect(postingBlockers({ remote: false, locationCity: 'Pune', skills: [{ isRequired: false }] })).toEqual([
      'Add at least one required skill.',
    ]);
  });
});
