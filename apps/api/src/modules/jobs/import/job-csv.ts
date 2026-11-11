import { EmploymentType, SkillLevel } from '@prisma/client';

/**
 * Bulk job import: the CSV template and how one row becomes a draft job.
 * Pure (no I/O) so it is unit-tested on its own; JobImportService does the
 * database, skills and location work.
 *
 * Template columns (header names are matched case-insensitively, spaces and
 * underscores alike; only title, description and employment type are
 * required):
 *
 *   code, title, description, employment type, location, remote,
 *   experience min, experience max, salary min (LPA), salary max (LPA),
 *   salary not disclosed, skills
 *
 * skills = "Skill name: level" separated by semicolons, level as L1–L4 or
 * Foundational / Practitioner / Advanced / Expert; add "(optional)" for a
 * nice-to-have skill, e.g. "RAG Systems: L2; Prompt Engineering: L1 (optional)".
 * Left empty, skills are suggested by AI from the description.
 */

export const MAX_IMPORT_ROWS = 50;

export const TEMPLATE_HEADERS = [
  'code',
  'title',
  'description',
  'employment type',
  'location',
  'remote',
  'experience min',
  'experience max',
  'salary min (LPA)',
  'salary max (LPA)',
  'salary not disclosed',
  'skills',
] as const;

type Column =
  | 'code'
  | 'title'
  | 'description'
  | 'employmentType'
  | 'location'
  | 'remote'
  | 'experienceMin'
  | 'experienceMax'
  | 'salaryMinLpa'
  | 'salaryMaxLpa'
  | 'salaryNotDisclosed'
  | 'skills';

const HEADER_ALIASES: Record<string, Column> = {
  code: 'code',
  'job code': 'code',
  'requisition id': 'code',
  title: 'title',
  'job title': 'title',
  role: 'title',
  description: 'description',
  'job description': 'description',
  jd: 'description',
  'employment type': 'employmentType',
  type: 'employmentType',
  location: 'location',
  city: 'location',
  remote: 'remote',
  'experience min': 'experienceMin',
  'min experience': 'experienceMin',
  'experience max': 'experienceMax',
  'max experience': 'experienceMax',
  'salary min (lpa)': 'salaryMinLpa',
  'salary min': 'salaryMinLpa',
  'salary max (lpa)': 'salaryMaxLpa',
  'salary max': 'salaryMaxLpa',
  'salary not disclosed': 'salaryNotDisclosed',
  skills: 'skills',
  'required skills': 'skills',
};

const LEVEL_WORDS: Record<string, SkillLevel> = {
  l1: SkillLevel.L1,
  '1': SkillLevel.L1,
  foundational: SkillLevel.L1,
  l2: SkillLevel.L2,
  '2': SkillLevel.L2,
  practitioner: SkillLevel.L2,
  l3: SkillLevel.L3,
  '3': SkillLevel.L3,
  advanced: SkillLevel.L3,
  l4: SkillLevel.L4,
  '4': SkillLevel.L4,
  expert: SkillLevel.L4,
};

const EMPLOYMENT_WORDS: Record<string, EmploymentType> = {
  'full time': EmploymentType.FULL_TIME,
  fulltime: EmploymentType.FULL_TIME,
  permanent: EmploymentType.FULL_TIME,
  'part time': EmploymentType.PART_TIME,
  parttime: EmploymentType.PART_TIME,
  contract: EmploymentType.CONTRACT,
  contractor: EmploymentType.CONTRACT,
  freelance: EmploymentType.CONTRACT,
  internship: EmploymentType.INTERNSHIP,
  intern: EmploymentType.INTERNSHIP,
};

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Excel leaves empty trailing lines (",,,,"); drop rows with no content.
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, ' ');

export interface HeaderMap {
  columns: Map<number, Column>;
  missing: string[];
  unknown: string[];
}

export function mapHeaders(header: string[]): HeaderMap {
  const columns = new Map<number, Column>();
  const unknown: string[] = [];
  header.forEach((h, i) => {
    const col = HEADER_ALIASES[norm(h)];
    if (col) columns.set(i, col);
    else if (h.trim()) unknown.push(h.trim());
  });
  const have = new Set(columns.values());
  const missing = (['title', 'description', 'employmentType'] as Column[])
    .filter((c) => !have.has(c))
    .map((c) => ({ title: 'title', description: 'description', employmentType: 'employment type' })[c as 'title']);
  return { columns, missing, unknown };
}

export interface SkillRequest {
  name: string;
  level: SkillLevel;
  isRequired: boolean;
}

export interface ImportRow {
  /** 1-based data row (the row under the header is 1), shown to the employer. */
  row: number;
  code: string | null;
  title: string;
  description: string;
  employmentType: EmploymentType | null;
  location: string | null;
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMinPaise: number | null;
  salaryMaxPaise: number | null;
  salaryNotDisclosed: boolean;
  skills: SkillRequest[];
  /** Problems that stop this row becoming a draft. */
  errors: string[];
  /** Problems the employer can fix on the draft before posting. */
  warnings: string[];
}

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim());
const LPA_TO_PAISE = 100_000 * 100;

function intOrNull(v: string, label: string, errors: string[], min: number, max: number): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < min || n > max) {
    errors.push(`${label} must be a number from ${min} to ${max}.`);
    return null;
  }
  return n;
}

export function parseSkills(cell: string, warnings: string[]): SkillRequest[] {
  const out: SkillRequest[] = [];
  for (const part of cell.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const optional = /\((optional|nice to have)\)/i.test(part);
    const clean = part.replace(/\((optional|nice to have)\)/gi, '').trim();
    const [rawName, rawLevel] = clean.split(/[:|]/).map((x) => (x ?? '').trim());
    if (!rawName) continue;
    const level = rawLevel ? LEVEL_WORDS[rawLevel.toLowerCase()] : SkillLevel.L1;
    if (!level) warnings.push(`Unknown level "${rawLevel}" for ${rawName}; set to Foundational (L1).`);
    out.push({ name: rawName, level: level ?? SkillLevel.L1, isRequired: !optional });
  }
  return out;
}

/** One data line → a candidate draft, with errors (row skipped) and warnings (fix before posting). */
export function toImportRow(cells: string[], columns: Map<number, Column>, row: number): ImportRow {
  const get = (c: Column) => {
    for (const [i, col] of columns) if (col === c) return (cells[i] ?? '').trim();
    return '';
  };
  const errors: string[] = [];
  const warnings: string[] = [];

  const title = get('title');
  if (!title) errors.push('Title is missing.');
  else if (title.length > 160) errors.push('Title is longer than 160 characters.');

  const description = get('description');
  if (description.length < 20) errors.push('Description is missing or shorter than 20 characters.');
  else if (description.length > 20000) errors.push('Description is longer than 20,000 characters.');

  const typeWord = get('employmentType').toLowerCase().replace(/[-_]/g, ' ').trim();
  const employmentType = EMPLOYMENT_WORDS[typeWord] ?? null;
  if (!employmentType) {
    errors.push(`Employment type "${get('employmentType')}" isn't one of Full-time, Part-time, Contract or Internship.`);
  }

  const rawCode = get('code');
  let code: string | null = null;
  if (rawCode) {
    if (!/^[A-Za-z0-9-]{1,40}$/.test(rawCode)) errors.push('Code may only contain letters, numbers and hyphens (up to 40).');
    else code = rawCode.toUpperCase();
  }

  const experienceMin = intOrNull(get('experienceMin'), 'Experience min', errors, 0, 50);
  const experienceMax = intOrNull(get('experienceMax'), 'Experience max', errors, 0, 50);
  if (experienceMin != null && experienceMax != null && experienceMin > experienceMax) {
    errors.push('Experience min is more than experience max.');
  }

  const salaryNotDisclosed = yes(get('salaryNotDisclosed'));
  const minLpa = intOrNull(get('salaryMinLpa'), 'Salary min (LPA)', errors, 0, 10_000);
  const maxLpa = intOrNull(get('salaryMaxLpa'), 'Salary max (LPA)', errors, 0, 10_000);
  let salaryMinPaise = minLpa != null ? Math.round(minLpa * LPA_TO_PAISE) : null;
  let salaryMaxPaise = maxLpa != null ? Math.round(maxLpa * LPA_TO_PAISE) : null;
  if (salaryNotDisclosed && (salaryMinPaise != null || salaryMaxPaise != null)) {
    warnings.push('Salary marked "not disclosed", so the salary numbers were left out.');
    salaryMinPaise = salaryMaxPaise = null;
  }
  if (salaryMinPaise != null && salaryMaxPaise != null && salaryMinPaise > salaryMaxPaise) {
    errors.push('Salary min is more than salary max.');
  }

  const location = get('location') || null;
  const remote = yes(get('remote'));
  const skills = parseSkills(get('skills'), warnings);

  return {
    row,
    code,
    title,
    description,
    employmentType,
    location,
    remote,
    experienceMin,
    experienceMax,
    salaryMinPaise,
    salaryMaxPaise,
    salaryNotDisclosed,
    skills,
    errors,
    warnings,
  };
}

/** "Bengaluru, Karnataka, India" → "bengaluru" — what a resolved city must match. */
export function cityPart(location: string): string {
  return location.split(',')[0].trim().toLowerCase();
}

/** What still blocks posting a draft (empty = ready). Same rules for imported and hand-made drafts. */
export function postingBlockers(job: {
  remote: boolean;
  locationCity: string | null;
  skills: { isRequired: boolean }[];
}): string[] {
  const out: string[] = [];
  if (!job.skills.some((s) => s.isRequired)) out.push('Add at least one required skill.');
  if (!job.locationCity && !job.remote) out.push('Pick a city, or mark the job remote.');
  return out;
}

/** The downloadable template: headers plus one example row. */
export function templateCsv(): string {
  const example = [
    'AI-001',
    'Senior ML Engineer',
    '"Build and evaluate retrieval-augmented generation systems for our support product. You will own evaluation, chunking strategy and model selection."',
    'Full-time',
    '"Bengaluru, India"',
    'no',
    '4',
    '8',
    '30',
    '45',
    'no',
    '"RAG Systems: L2; Prompt Engineering: L1 (optional)"',
  ];
  return `${TEMPLATE_HEADERS.join(',')}\r\n${example.join(',')}\r\n`;
}
