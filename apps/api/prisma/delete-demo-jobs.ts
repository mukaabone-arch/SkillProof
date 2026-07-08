// Removes everything seed-demo-jobs.ts creates: the demo jobs, their
// JobSkill rows, any applications against them, and the placeholder
// "Demo Listings (Imported)" org itself. Only ever touches that one org by
// name — never a real employer.
//
// Run from apps/api:
//   npx ts-node prisma/delete-demo-jobs.ts
import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';

const DEMO_ORG_NAME = 'Demo Listings (Imported)';
const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: DEMO_ORG_NAME } });
  if (!org) {
    console.log(`No "${DEMO_ORG_NAME}" org found — nothing to clean up.`);
    return;
  }

  const jobs = await prisma.job.findMany({ where: { orgId: org.id }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);

  const [apps, skills] = await Promise.all([
    prisma.application.deleteMany({ where: { jobId: { in: jobIds } } }),
    prisma.jobSkill.deleteMany({ where: { jobId: { in: jobIds } } }),
  ]);
  const { count: jobCount } = await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.organization.delete({ where: { id: org.id } });

  console.log(
    `Deleted ${jobCount} job(s), ${skills.count} job-skill row(s), ${apps.count} application(s), ` +
      `and the "${DEMO_ORG_NAME}" org.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
