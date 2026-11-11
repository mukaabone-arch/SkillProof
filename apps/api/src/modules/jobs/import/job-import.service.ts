import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { LlmService } from '../../../llm/llm.service';
import { LocationSearchService } from '../../locations/location-search.service';
import { LocationSuggestion } from '../../locations/location-search-provider.interface';
import { formatLocation } from '../../locations/location-format.util';
import { cityPart, ImportRow, mapHeaders, MAX_IMPORT_ROWS, parseCsv, postingBlockers, toImportRow } from './job-csv';

export interface ImportRowResult {
  row: number;
  title: string;
  code: string | null;
  status: 'created' | 'skipped';
  jobId?: string;
  errors: string[];
  warnings: string[];
  /** What still stops the created draft being posted. */
  blockers: string[];
}

export interface ImportResult {
  batchId: string | null;
  created: number;
  skipped: number;
  rows: ImportRowResult[];
}

/** Common ways people write a country after the city, mapped to the ISO code Places returns. */
const COUNTRY_WORDS: Record<string, string> = {
  india: 'IN',
  in: 'IN',
  uae: 'AE',
  'united arab emirates': 'AE',
  ae: 'AE',
  'saudi arabia': 'SA',
  ksa: 'SA',
  sa: 'SA',
  usa: 'US',
  us: 'US',
  'united states': 'US',
  uk: 'GB',
  'united kingdom': 'GB',
  gb: 'GB',
  singapore: 'SG',
  sg: 'SG',
};

const AI_CONCURRENCY = 3;

/**
 * Bulk job import (employer portal): a CSV of up to 50 jobs becomes DRAFT
 * jobs that share an importBatchId. Nothing is posted here — the employer
 * reviews the drafts and posts the ready ones (publish), keeping the rule
 * that a person checks AI-suggested skills before they affect matching.
 *
 * Per row: required fields are validated (bad rows are skipped and
 * reported, never half-created); skills named in the file are matched to
 * the taxonomy by name or alias; a row with no usable skills gets AI
 * suggestions from its description (LlmService.extractJobFields, the same
 * call as the single-job "Fill with AI"); the location text is resolved to a
 * structured city through the same Places search the job form uses.
 */
@Injectable()
export class JobImportService {
  private readonly logger = new Logger(JobImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly locations: LocationSearchService,
  ) {}

  async importCsv(orgId: string, userId: string, buffer: Buffer): Promise<ImportResult> {
    const table = parseCsv(buffer.toString('utf8'));
    if (table.length < 2) throw new BadRequestException('The file has no job rows under the header.');
    const { columns, missing } = mapHeaders(table[0]);
    if (missing.length) {
      throw new BadRequestException(`The file is missing these columns: ${missing.join(', ')}. Start from the template.`);
    }
    const dataRows = table.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Up to ${MAX_IMPORT_ROWS} jobs per file; this one has ${dataRows.length}. Split it and upload each part.`);
    }

    const rows = dataRows.map((cells, i) => toImportRow(cells, columns, i + 1));
    await this.assignCodes(orgId, rows);

    const valid = rows.filter((r) => !r.errors.length);
    const [skillIdsByRow, locationsByText] = await Promise.all([
      this.resolveSkills(valid),
      this.resolveLocations(userId, valid),
    ]);

    const batchId = valid.length ? randomUUID() : null;
    const created = new Map<number, { id: string; blockers: string[] }>();
    if (batchId) {
      try {
        await this.prisma.$transaction(async (tx) => {
          for (const r of valid) {
            const loc = r.location ? locationsByText.get(r.location.toLowerCase()) ?? null : null;
            const skills = skillIdsByRow.get(r.row) ?? [];
            const job = await tx.job.create({
              data: {
                orgId,
                importBatchId: batchId,
                status: JobStatus.DRAFT,
                code: r.code!,
                title: r.title,
                description: r.description,
                employmentType: r.employmentType!,
                remote: r.remote,
                experienceMin: r.experienceMin,
                experienceMax: r.experienceMax,
                salaryMin: r.salaryMinPaise,
                salaryMax: r.salaryMaxPaise,
                salaryNotDisclosed: r.salaryNotDisclosed,
                ...(loc
                  ? {
                      locationCity: loc.city,
                      locationRegion: loc.region,
                      locationCountry: loc.country,
                      locationPlaceId: loc.placeId,
                      locationLat: loc.lat,
                      locationLng: loc.lng,
                    }
                  : {}),
              },
              select: { id: true },
            });
            if (skills.length) {
              await tx.jobSkill.createMany({
                data: skills.map((s) => ({ jobId: job.id, skillId: s.skillId, requiredLevel: s.level, isRequired: s.isRequired })),
              });
            }
            created.set(r.row, {
              id: job.id,
              blockers: postingBlockers({ remote: r.remote, locationCity: loc?.city ?? null, skills }),
            });
          }
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('A job code in this file was just used by another job. Upload the file again.');
        }
        throw err;
      }
    }

    const results: ImportRowResult[] = rows.map((r) => {
      const c = created.get(r.row);
      return {
        row: r.row,
        title: r.title,
        code: r.code,
        status: c ? 'created' : 'skipped',
        ...(c ? { jobId: c.id } : {}),
        errors: r.errors,
        warnings: r.warnings,
        blockers: c?.blockers ?? [],
      };
    });
    this.logger.log(`Job import for org ${orgId}: ${created.size} drafts, ${rows.length - created.size} skipped (batch ${batchId}).`);
    return { batchId, created: created.size, skipped: rows.length - created.size, rows: results };
  }

  /** The drafts (and anything since posted) from one upload, with what still blocks each. */
  async batch(orgId: string, batchId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { orgId, importBatchId: batchId },
      orderBy: { code: 'asc' },
      include: { skills: { include: { skill: { select: { name: true } } } } },
    });
    return jobs.map((j) => ({
      id: j.id,
      code: j.code,
      title: j.title,
      status: j.status,
      employmentType: j.employmentType,
      location: j.remote && !j.locationCity ? 'Remote' : formatLocation(j),
      remote: j.remote,
      skills: j.skills.map((s) => ({ name: s.skill.name, level: s.requiredLevel, isRequired: s.isRequired })),
      blockers: j.status === JobStatus.DRAFT ? postingBlockers(j) : [],
    }));
  }

  /** Posts every listed draft that is ready; reports the rest with the reason. */
  async publish(orgId: string, jobIds: string[]) {
    const jobs = await this.prisma.job.findMany({
      where: { orgId, id: { in: jobIds } },
      include: { skills: { select: { isRequired: true } } },
    });
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const published: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of jobIds) {
      const j = byId.get(id);
      if (!j) {
        skipped.push({ id, reason: 'Job not found.' });
        continue;
      }
      if (j.status !== JobStatus.DRAFT) {
        skipped.push({ id, reason: j.status === JobStatus.LIVE ? 'Already posted.' : 'This job is closed.' });
        continue;
      }
      const blockers = postingBlockers(j);
      if (blockers.length) {
        skipped.push({ id, reason: blockers.join(' ') });
        continue;
      }
      // Guarded on DRAFT so a double click can't flip a job twice.
      const { count } = await this.prisma.job.updateMany({ where: { id, orgId, status: JobStatus.DRAFT }, data: { status: JobStatus.LIVE } });
      if (count) published.push(id);
      else skipped.push({ id, reason: 'Already posted.' });
    }
    return { published, skipped };
  }

  /** Codes must be unique per org: check given ones, generate JOB-NNNN for blank ones. */
  private async assignCodes(orgId: string, rows: ImportRow[]): Promise<void> {
    const existing = new Set(
      (await this.prisma.job.findMany({ where: { orgId }, select: { code: true } })).map((j) => j.code.toUpperCase()),
    );
    const used = new Set<string>();
    for (const r of rows) {
      if (!r.code) continue;
      if (existing.has(r.code)) r.errors.push(`Code ${r.code} is already used by one of your jobs.`);
      else if (used.has(r.code)) r.errors.push(`Code ${r.code} appears more than once in this file.`);
      used.add(r.code);
    }
    let next = 1 + Math.max(0, ...[...existing, ...used].map((c) => Number(/^JOB-(\d+)$/.exec(c)?.[1] ?? 0)));
    for (const r of rows) {
      if (r.code || r.errors.length) continue;
      let code = `JOB-${String(next++).padStart(4, '0')}`;
      while (existing.has(code) || used.has(code)) code = `JOB-${String(next++).padStart(4, '0')}`;
      used.add(code);
      r.code = code;
    }
  }

  /** Taxonomy match for named skills; AI suggestions for rows with none. Keyed by row number. */
  private async resolveSkills(rows: ImportRow[]) {
    const taxonomy = await this.prisma.skill.findMany({ select: { id: true, name: true, aliases: true } });
    const byName = new Map<string, { id: string; name: string }>();
    for (const s of taxonomy) {
      byName.set(s.name.toLowerCase(), s);
      for (const a of s.aliases) byName.set(a.toLowerCase(), s);
    }
    const out = new Map<number, { skillId: string; level: ImportRow['skills'][number]['level']; isRequired: boolean }[]>();
    const needAi: ImportRow[] = [];

    for (const r of rows) {
      const matched: { skillId: string; level: ImportRow['skills'][number]['level']; isRequired: boolean }[] = [];
      for (const s of r.skills) {
        const hit = byName.get(s.name.toLowerCase());
        if (!hit) r.warnings.push(`"${s.name}" isn't in MyAmbii's skill list, so it was left out.`);
        else if (!matched.some((m) => m.skillId === hit.id)) matched.push({ skillId: hit.id, level: s.level, isRequired: s.isRequired });
      }
      out.set(r.row, matched);
      if (!matched.length) needAi.push(r);
    }

    const names = taxonomy.map((s) => s.name);
    for (let i = 0; i < needAi.length; i += AI_CONCURRENCY) {
      await Promise.all(
        needAi.slice(i, i + AI_CONCURRENCY).map(async (r) => {
          try {
            const ex = await this.llm.extractJobFields(r.description, names);
            const suggested = ex.suggestedSkills
              .map((s) => ({ hit: byName.get(s.skillName.toLowerCase()), s }))
              .filter((x): x is { hit: { id: string; name: string }; s: (typeof ex.suggestedSkills)[number] } => !!x.hit)
              .map(({ hit, s }) => ({ skillId: hit.id, level: s.requiredLevel, isRequired: s.isRequired }));
            out.set(r.row, suggested);
            if (r.experienceMin == null && ex.experienceMin != null) r.experienceMin = ex.experienceMin;
            if (r.experienceMax == null && ex.experienceMax != null) r.experienceMax = ex.experienceMax;
            r.warnings.push(
              suggested.length
                ? 'Skills were suggested by AI from the description. Check them before posting.'
                : "AI couldn't find matching skills in the description. Add them on the draft.",
            );
          } catch {
            r.warnings.push("Skills couldn't be suggested right now. Add them on the draft.");
          }
        }),
      );
    }
    return out;
  }

  /** Each distinct location text resolved once; keyed by lowercased text. Unresolved ones get a warning. */
  private async resolveLocations(userId: string, rows: ImportRow[]) {
    const out = new Map<string, LocationSuggestion>();
    const texts = [...new Set(rows.map((r) => r.location?.trim()).filter((t): t is string => !!t))];
    const outcome = new Map<string, { loc: LocationSuggestion | null; note: string | null }>();

    for (const text of texts) {
      let suggestions: LocationSuggestion[] = [];
      try {
        suggestions = await this.locations.search(userId, text);
      } catch {
        outcome.set(text, { loc: null, note: `Couldn't look up "${text}" right now. Pick the city on the draft.` });
        continue;
      }
      const exact = suggestions.find((s) => sameCity(text, s));
      if (exact) outcome.set(text, { loc: exact, note: null });
      else if (suggestions[0]) {
        const s = suggestions[0];
        outcome.set(text, {
          loc: s,
          note: `Location "${text}" was matched to ${[s.city, s.region, s.country].filter(Boolean).join(', ')}. Check it.`,
        });
      } else outcome.set(text, { loc: null, note: `Couldn't find "${text}". Pick the city on the draft.` });
    }

    for (const r of rows) {
      const text = r.location?.trim();
      if (!text) continue;
      const o = outcome.get(text)!;
      if (o.loc) out.set(text.toLowerCase(), o.loc);
      if (o.note) r.warnings.push(o.note);
    }
    return out;
  }
}

/** The city name matches, and so does the country when the text names one ("Hyderabad, India" never becomes Pakistan). */
export function sameCity(text: string, s: LocationSuggestion): boolean {
  if (cityPart(text) !== s.city.trim().toLowerCase()) return false;
  const parts = text.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length < 2) return true;
  const last = parts[parts.length - 1];
  const code = COUNTRY_WORDS[last];
  if (code) return s.country.toUpperCase() === code;
  return (s.region ?? '').toLowerCase() === last || s.country.toLowerCase() === last;
}
