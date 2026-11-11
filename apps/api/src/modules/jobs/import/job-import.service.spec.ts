import { BadRequestException } from '@nestjs/common';
import { JobStatus, SkillLevel } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { LlmService } from '../../../llm/llm.service';
import { LocationSearchService } from '../../locations/location-search.service';
import { JobImportService, sameCity } from './job-import.service';
import { TEMPLATE_HEADERS } from './job-csv';

const HEADER = TEMPLATE_HEADERS.join(',');
const DESC = '"Own retrieval quality and evaluation for our assistant product."';

function csv(...lines: string[]) {
  return Buffer.from([HEADER, ...lines].join('\r\n'), 'utf8');
}

const BLR = { placeId: 'p1', city: 'Bengaluru', region: 'Karnataka', country: 'IN', lat: 12.9, lng: 77.6 };

function setup(opts: { existingCodes?: string[] } = {}) {
  const jobs: Record<string, unknown>[] = [];
  const skills: Record<string, unknown>[] = [];
  const tx = {
    job: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `job-${jobs.length + 1}`;
        jobs.push({ id, ...data });
        return { id };
      }),
    },
    jobSkill: { createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => skills.push(...data)) },
  };
  const prisma = {
    job: {
      findMany: jest.fn(async () => (opts.existingCodes ?? []).map((code) => ({ code }))),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    skill: {
      findMany: jest.fn(async () => [
        { id: 's-rag', name: 'RAG Systems', aliases: ['retrieval augmented generation'] },
        { id: 's-pe', name: 'Prompt Engineering', aliases: [] },
      ]),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  const llm = {
    extractJobFields: jest.fn(async () => ({
      title: null,
      suggestedSkills: [{ skillName: 'RAG Systems', requiredLevel: SkillLevel.L2, isRequired: true }],
      experienceMin: 3,
      experienceMax: 6,
    })),
  };
  const locations = {
    search: jest.fn(async (_u: string, q: string) =>
      q.toLowerCase().startsWith('bang') || q.toLowerCase().startsWith('beng') ? [BLR] : [],
    ),
  };
  const svc = new JobImportService(
    prisma as unknown as PrismaService,
    llm as unknown as LlmService,
    locations as unknown as LocationSearchService,
  );
  return { svc, prisma, llm, locations, jobs, skills };
}

describe('JobImportService.importCsv', () => {
  it('creates drafts with matched skills and a resolved city, sharing one batch id', async () => {
    const { svc, jobs, skills, llm } = setup();
    const res = await svc.importCsv(
      'org1',
      'u1',
      csv(
        `AI-1,ML Engineer,${DESC},Full-time,"Bengaluru, India",no,2,5,20,30,no,"RAG Systems: L2; retrieval augmented generation: L3"`,
        `,Prompt Engineer,${DESC},Contract,,yes,,,,,,Prompt Engineering: L1`,
      ),
    );

    expect(res.created).toBe(2);
    expect(res.batchId).toBeTruthy();
    expect(jobs[0]).toMatchObject({
      code: 'AI-1',
      status: JobStatus.DRAFT,
      importBatchId: res.batchId,
      locationCity: 'Bengaluru',
      locationCountry: 'IN',
      salaryMin: 20 * 100_000 * 100,
    });
    // Same skill named twice (name and alias) is kept once.
    expect(skills.filter((s) => s.jobId === 'job-1')).toEqual([
      { jobId: 'job-1', skillId: 's-rag', requiredLevel: SkillLevel.L2, isRequired: true },
    ]);
    expect(jobs[1]).toMatchObject({ code: 'JOB-0001', remote: true });
    expect(res.rows.every((r) => r.blockers.length === 0)).toBe(true);
    expect(llm.extractJobFields).not.toHaveBeenCalled();
  });

  it('skips bad rows with their errors and still creates the good ones', async () => {
    const { svc, jobs } = setup({ existingCodes: ['AI-1'] });
    const res = await svc.importCsv(
      'org1',
      'u1',
      csv(
        `AI-1,Taken code,${DESC},Full-time,,yes,,,,,,Prompt Engineering`,
        `AI-2,,${DESC},Full-time,,yes,,,,,,Prompt Engineering`,
        `AI-3,Good one,${DESC},Full-time,,yes,,,,,,Prompt Engineering`,
      ),
    );
    expect(res.rows.map((r) => r.status)).toEqual(['skipped', 'skipped', 'created']);
    expect(res.rows[0].errors[0]).toMatch(/already used/);
    expect(res.rows[1].errors).toContain('Title is missing.');
    expect(jobs).toHaveLength(1);
  });

  it('asks AI for skills when none are given, fills missing experience, and says so', async () => {
    const { svc, skills, jobs, llm } = setup();
    const res = await svc.importCsv('org1', 'u1', csv(`,RAG Engineer,${DESC},Full-time,,yes,,,,,,`));
    expect(llm.extractJobFields).toHaveBeenCalledTimes(1);
    expect(skills).toEqual([{ jobId: 'job-1', skillId: 's-rag', requiredLevel: SkillLevel.L2, isRequired: true }]);
    expect(jobs[0]).toMatchObject({ experienceMin: 3, experienceMax: 6 });
    expect(res.rows[0].warnings[0]).toMatch(/suggested by AI/);
  });

  it('warns about unknown skills and unresolved cities, and reports what blocks posting', async () => {
    const { svc } = setup();
    const res = await svc.importCsv('org1', 'u1', csv(`,Data Lead,${DESC},Full-time,Atlantis,no,,,,,,"Quantum Knitting: L2"`));
    const r = res.rows[0];
    expect(r.status).toBe('created');
    expect(r.warnings.join(' ')).toMatch(/Quantum Knitting.*left out/);
    expect(r.warnings.join(' ')).toMatch(/Couldn't find "Atlantis"/);
    expect(r.blockers).toEqual(['Pick a city, or mark the job remote.']);
  });

  it('looks each distinct location up once', async () => {
    const { svc, locations } = setup();
    await svc.importCsv(
      'org1',
      'u1',
      csv(
        `,A role,${DESC},Full-time,"Bengaluru, India",no,,,,,,Prompt Engineering`,
        `,B role,${DESC},Full-time,"Bengaluru, India",no,,,,,,Prompt Engineering`,
      ),
    );
    expect(locations.search).toHaveBeenCalledTimes(1);
  });

  it('rejects files without required columns or with too many rows', async () => {
    const { svc } = setup();
    await expect(svc.importCsv('org1', 'u1', Buffer.from('title,location\nX,Y'))).rejects.toThrow(/missing these columns/);
    const many = Array.from({ length: 51 }, (_, i) => `,Role ${i},${DESC},Full-time,,yes,,,,,,Prompt Engineering`);
    await expect(svc.importCsv('org1', 'u1', csv(...many))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('JobImportService.publish', () => {
  it('posts ready drafts and reports the rest', async () => {
    const { svc, prisma } = setup();
    prisma.job.findMany.mockResolvedValueOnce([
      { id: 'a', status: JobStatus.DRAFT, remote: true, locationCity: null, skills: [{ isRequired: true }] },
      { id: 'b', status: JobStatus.DRAFT, remote: false, locationCity: null, skills: [{ isRequired: true }] },
      { id: 'c', status: JobStatus.LIVE, remote: true, locationCity: null, skills: [{ isRequired: true }] },
    ] as never);
    const res = await svc.publish('org1', ['a', 'b', 'c', 'zzz']);
    expect(res.published).toEqual(['a']);
    expect(res.skipped).toEqual([
      { id: 'b', reason: 'Pick a city, or mark the job remote.' },
      { id: 'c', reason: 'Already posted.' },
      { id: 'zzz', reason: 'Job not found.' },
    ]);
    expect(prisma.job.updateMany).toHaveBeenCalledWith({ where: { id: 'a', orgId: 'org1', status: JobStatus.DRAFT }, data: { status: JobStatus.LIVE } });
  });
});

describe('sameCity', () => {
  it('needs the city and, when given, the country to match', () => {
    expect(sameCity('Bengaluru', BLR)).toBe(true);
    expect(sameCity('Bengaluru, India', BLR)).toBe(true);
    expect(sameCity('Bengaluru, Karnataka', BLR)).toBe(true);
    expect(sameCity('Bengaluru, UAE', BLR)).toBe(false);
    expect(sameCity('Bangalore', BLR)).toBe(false);
  });
});
