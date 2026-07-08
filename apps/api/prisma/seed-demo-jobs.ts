// ============================================================================
// DISPOSABLE DEMO FIXTURE — NOT REAL EMPLOYER DATA.
//
// Loads sample job listings from demo_jobs_clean.json so the matching engine
// has something to score against locally. Every job lands under a single,
// clearly-labeled placeholder org ("Demo Listings (Imported)") — never a real
// employer account — so this batch is trivial to spot and bulk-delete later.
// See delete-demo-jobs.ts (same directory) to remove everything this script
// creates.
//
// Run from apps/api:
//   npx ts-node prisma/seed-demo-jobs.ts
//
// Requires ANTHROPIC_API_KEY (reuses LlmService.extractJobFields — the same
// JD-parsing pipeline as POST /jobs/parse-description — one call per job,
// ~30 calls for the bundled fixture file).
//
// Idempotency: if the demo org already has jobs, this CLEARS them (and their
// applications/skills) before reloading, so re-running always reflects the
// current contents of demo_jobs_clean.json rather than duplicating rows.
// ============================================================================
import { config } from 'dotenv';
config();

import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EmploymentType, PrismaClient } from '@prisma/client';
import { LlmService } from '../src/llm/llm.service';

const DEMO_ORG_NAME = 'Demo Listings (Imported)';
const INPUT_FILE = join(__dirname, 'demo_jobs_clean.json');

interface DemoJobRecord {
  title: string;
  company_label: string;
  description: string;
  location: string;
  employmentType: string;
}

const prisma = new PrismaClient();
const llm = new LlmService();

function isRemote(location: string): boolean {
  return location.toLowerCase().includes('remote');
}

function toEmploymentType(value: string): EmploymentType {
  if (value in EmploymentType) return value as EmploymentType;
  throw new Error(`Unrecognized employmentType "${value}" — expected one of ${Object.keys(EmploymentType).join(', ')}`);
}

/** Wipes any jobs already under the demo org (and their skills/applications) so a re-run doesn't duplicate. */
async function clearExisting(orgId: string): Promise<void> {
  const existing = await prisma.job.findMany({ where: { orgId }, select: { id: true } });
  if (existing.length === 0) return;

  console.log(`Demo org already has ${existing.length} job(s) — clearing before reload.`);
  const jobIds = existing.map((j) => j.id);
  await prisma.application.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobSkill.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
}

async function main() {
  const records: DemoJobRecord[] = JSON.parse(readFileSync(INPUT_FILE, 'utf-8'));
  console.log(`Loaded ${records.length} demo job record(s) from ${INPUT_FILE}`);

  // Organization.name has no unique constraint, so this is a plain find-then-create rather than an upsert.
  const org =
    (await prisma.organization.findFirst({ where: { name: DEMO_ORG_NAME } })) ??
    (await prisma.organization.create({ data: { name: DEMO_ORG_NAME } }));
  await clearExisting(org.id);

  const taxonomySkillNames = (await prisma.skill.findMany({ select: { name: true } })).map((s) => s.name);

  let createdCount = 0;
  let withSkillsCount = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const label = `[${i + 1}/${records.length}] "${record.title}"`;
    const description = `Company: ${record.company_label}\n\n${record.description}`;

    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        title: record.title,
        description,
        employmentType: toEmploymentType(record.employmentType),
        location: record.location,
        remote: isRemote(record.location),
        status: 'LIVE',
      },
    });
    createdCount++;

    try {
      const extraction = await llm.extractJobFields(description, taxonomySkillNames);
      const skills = await prisma.skill.findMany({
        where: { name: { in: extraction.suggestedSkills.map((s) => s.skillName) } },
      });
      const skillIdByName = new Map(skills.map((s) => [s.name, s.id]));

      const rows = extraction.suggestedSkills
        .filter((s) => skillIdByName.has(s.skillName))
        .map((s) => ({
          jobId: job.id,
          skillId: skillIdByName.get(s.skillName)!,
          requiredLevel: s.requiredLevel,
          isRequired: s.isRequired,
        }));

      if (rows.length > 0) {
        await prisma.jobSkill.createMany({ data: rows });
        withSkillsCount++;
      }
      console.log(`${label} — ${rows.length} skill(s) attached`);
    } catch (err) {
      console.error(`${label} — JD parse failed, job created without skills: ${(err as Error).message}`);
    }
  }

  console.log('\n--- Demo job import summary ---');
  console.log(`Org: "${DEMO_ORG_NAME}" (${org.id})`);
  console.log(`${createdCount} job(s) created, ${withSkillsCount} with skills attached.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
