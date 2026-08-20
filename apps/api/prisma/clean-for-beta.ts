// One-time pre-beta database cleanup. Keeps: Organization
// KEPT_ORG_ID, its member(s), every CandidateProfile/candidate User, the
// entire taxonomy (Domain/Skill), and Assessment/Question/InterviewQuestion
// content banks. Deletes: every other Organization and everything that
// references them, the employer User rows those orgs own, and — separately,
// org-independent — every Attempt/AttemptAnswer/IntegrityEvent/
// QuestionServedAt row and every Badge row, regardless of which user they
// belong to (including kept candidates' badges — see the SkillClaim
// handling below for why that's not silently destructive).
//
// Dry-run by default: prints exactly what would be deleted, deletes
// nothing. Only --execute performs real deletes, inside one transaction
// (a failure partway through rolls back everything, never leaves a
// half-cleaned DB).
//
// Run from apps/api:
//   npx ts-node prisma/clean-for-beta.ts              (dry run)
//   npx ts-node prisma/clean-for-beta.ts --execute     (the real thing)
import { config } from 'dotenv';
config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KEPT_ORG_ID = '6be1d55a-a417-4a8d-98a5-7626dc013534'; // Mukaab Technologies (the real one — see report, org names are NOT unique in this DB)

const EXECUTE = process.argv.includes('--execute');

/**
 * SkillClaim handling for the 4 (as of the investigation) VERIFIED claims
 * whose badge is about to be deleted. Two options exist (see the written
 * report) — this is the RECOMMENDED one, not yet approved for --execute:
 * null the badgeId and revert status to UNVERIFIED, rather than deleting
 * the claim row outright. Preserves the candidate's own claim (they did
 * assert this skill) while accurately reflecting that verifying evidence
 * no longer exists — a fully valid, ordinary state this schema already
 * supports for every brand-new claim. Never touches the OTHER pre-existing
 * VERIFIED+badgeId=null rows already in the DB (see report) — only claims
 * that currently reference a badge this run is about to delete.
 */
const SKILL_CLAIM_STRATEGY: 'REVERT_TO_UNVERIFIED' | 'DELETE' = 'REVERT_TO_UNVERIFIED';

/**
 * Exactly one User row (mukaabone@gmail.com, confirmed by investigation) is
 * both a doomed employer (member of a deleted org) AND owns a
 * CandidateProfile — an empty shell (no name, zero skill claims/
 * applications/attempts). Deleting the User row is explicitly requested;
 * deleting a CandidateProfile is explicitly forbidden. These directly
 * conflict for this one row, so --execute refuses to run at all unless
 * this flag confirms the resolution — never silently picked either way.
 * See the written report for why deleting the (empty, artifact) profile
 * alongside its employer account is the recommendation.
 */
const RESOLVE_EMPLOYER_CANDIDATE_PROFILE_CONFLICT = process.argv.includes(
  '--delete-empty-employer-profile',
);

interface Counts {
  [table: string]: number;
}

async function main() {
  console.log(EXECUTE ? '*** EXECUTE MODE — this will delete data ***' : 'DRY RUN — nothing will be deleted (pass --execute to actually delete)');
  console.log('');

  const keptOrg = await prisma.organization.findUnique({ where: { id: KEPT_ORG_ID } });
  if (!keptOrg) {
    throw new Error(`Kept org ${KEPT_ORG_ID} not found — aborting rather than guessing.`);
  }
  console.log(`Keeping: "${keptOrg.name}" (${KEPT_ORG_ID})`);

  const deletedOrgs = await prisma.organization.findMany({
    where: { id: { not: KEPT_ORG_ID } },
    select: { id: true, name: true },
  });
  const deletedOrgIds = deletedOrgs.map((o) => o.id);
  console.log(`Deleting: ${deletedOrgs.length} other organisation(s).`);
  console.log('');

  // ---- Resolve the doomed-employer set up front (used by several counts below) ----
  const doomedEmployers = await prisma.user.findMany({
    where: { orgMembership: { organizationId: { in: deletedOrgIds } } },
    select: { id: true, email: true },
  });
  const doomedEmployerIds = doomedEmployers.map((u) => u.id);

  // ---- Flag the employer/candidate-profile conflict up front, loudly ----
  const conflictingProfiles = await prisma.candidateProfile.findMany({
    where: { userId: { in: doomedEmployerIds } },
    select: { id: true, userId: true, fullName: true },
  });
  if (conflictingProfiles.length > 0) {
    console.log('⚠ CONFLICT — requires your decision:');
    for (const p of conflictingProfiles) {
      const u = doomedEmployers.find((e) => e.id === p.userId);
      console.log(
        `  User ${u?.email} (${p.userId}) is a doomed employer AND owns CandidateProfile ${p.id} ` +
          `(fullName=${JSON.stringify(p.fullName) || 'null'}). Deleting the employer User row is ` +
          `requested; deleting a CandidateProfile is forbidden. These conflict for this one row.`,
      );
    }
    console.log(
      RESOLVE_EMPLOYER_CANDIDATE_PROFILE_CONFLICT
        ? '  --delete-empty-employer-profile was passed: will delete the CandidateProfile row(s) above along with their User.'
        : '  Not resolved. Pass --delete-empty-employer-profile to delete these specific profiles too, or this run will refuse to --execute.',
    );
    console.log('');
  }

  console.log(`SkillClaim strategy for badges about to be deleted: ${SKILL_CLAIM_STRATEGY}`);
  console.log('');

  if (EXECUTE && conflictingProfiles.length > 0 && !RESOLVE_EMPLOYER_CANDIDATE_PROFILE_CONFLICT) {
    throw new Error(
      'Refusing to --execute: the employer/candidate-profile conflict above is unresolved. ' +
        'Re-run with --delete-empty-employer-profile once you have approved that, or resolve it another way first.',
    );
  }

  const counts: Counts = {};
  const record = (table: string, n: number) => {
    counts[table] = (counts[table] ?? 0) + n;
  };

  await prisma.$transaction(
    async (tx) => {
      // ================= PHASE 1: org-scoped children (deepest first) =================

      const deletedOrgJobs = await tx.job.findMany({ where: { orgId: { in: deletedOrgIds } }, select: { id: true } });
      const deletedOrgJobIds = deletedOrgJobs.map((j) => j.id);

      const deletedOrgShortlistEntries = await tx.shortlistEntry.findMany({
        where: { orgId: { in: deletedOrgIds } },
        select: { id: true },
      });
      const deletedOrgShortlistEntryIds = deletedOrgShortlistEntries.map((s) => s.id);

      record(
        'JobSkill',
        await countOrDelete(EXECUTE, () => tx.jobSkill.count({ where: { jobId: { in: deletedOrgJobIds } } }), () =>
          tx.jobSkill.deleteMany({ where: { jobId: { in: deletedOrgJobIds } } }),
        ),
      );
      record(
        'Application',
        await countOrDelete(EXECUTE, () => tx.application.count({ where: { jobId: { in: deletedOrgJobIds } } }), () =>
          tx.application.deleteMany({ where: { jobId: { in: deletedOrgJobIds } } }),
        ),
      );
      record(
        'InterviewRound',
        await countOrDelete(
          EXECUTE,
          () => tx.interviewRound.count({ where: { shortlistEntryId: { in: deletedOrgShortlistEntryIds } } }),
          () => tx.interviewRound.deleteMany({ where: { shortlistEntryId: { in: deletedOrgShortlistEntryIds } } }),
        ),
      );
      record(
        'ShortlistEntry',
        await countOrDelete(EXECUTE, () => tx.shortlistEntry.count({ where: { orgId: { in: deletedOrgIds } } }), () =>
          tx.shortlistEntry.deleteMany({ where: { orgId: { in: deletedOrgIds } } }),
        ),
      );
      record(
        'Job',
        await countOrDelete(EXECUTE, () => tx.job.count({ where: { orgId: { in: deletedOrgIds } } }), () =>
          tx.job.deleteMany({ where: { orgId: { in: deletedOrgIds } } }),
        ),
      );

      const deletedOrgBillingProfiles = await tx.billingProfile.findMany({
        where: { organizationId: { in: deletedOrgIds } },
        select: { id: true },
      });
      const deletedOrgBillingProfileIds = deletedOrgBillingProfiles.map((b) => b.id);
      record(
        'Transaction',
        await countOrDelete(
          EXECUTE,
          () => tx.transaction.count({ where: { billingProfileId: { in: deletedOrgBillingProfileIds } } }),
          () => tx.transaction.deleteMany({ where: { billingProfileId: { in: deletedOrgBillingProfileIds } } }),
        ),
      );
      record(
        'BillingProfile',
        await countOrDelete(
          EXECUTE,
          () => tx.billingProfile.count({ where: { organizationId: { in: deletedOrgIds } } }),
          () => tx.billingProfile.deleteMany({ where: { organizationId: { in: deletedOrgIds } } }),
        ),
      );

      record(
        'AssessmentRequest',
        await countOrDelete(
          EXECUTE,
          () => tx.assessmentRequest.count({ where: { orgId: { in: deletedOrgIds } } }),
          () => tx.assessmentRequest.deleteMany({ where: { orgId: { in: deletedOrgIds } } }),
        ),
      );
      record(
        'OrgInvitation',
        await countOrDelete(
          EXECUTE,
          () => tx.orgInvitation.count({ where: { organizationId: { in: deletedOrgIds } } }),
          () => tx.orgInvitation.deleteMany({ where: { organizationId: { in: deletedOrgIds } } }),
        ),
      );
      record(
        'AdminAccessLog(org)',
        await countOrDelete(
          EXECUTE,
          () => tx.adminAccessLog.count({ where: { organizationId: { in: deletedOrgIds } } }),
          () => tx.adminAccessLog.deleteMany({ where: { organizationId: { in: deletedOrgIds } } }),
        ),
      );
      record(
        'OrgMember',
        await countOrDelete(
          EXECUTE,
          () => tx.orgMember.count({ where: { organizationId: { in: deletedOrgIds } } }),
          () => tx.orgMember.deleteMany({ where: { organizationId: { in: deletedOrgIds } } }),
        ),
      );

      // ================= PHASE 2: doomed employers' own direct references =================

      record(
        'Identity',
        await countOrDelete(EXECUTE, () => tx.identity.count({ where: { userId: { in: doomedEmployerIds } } }), () =>
          tx.identity.deleteMany({ where: { userId: { in: doomedEmployerIds } } }),
        ),
      );
      record(
        'RefreshToken',
        await countOrDelete(
          EXECUTE,
          () => tx.refreshToken.count({ where: { userId: { in: doomedEmployerIds } } }),
          () => tx.refreshToken.deleteMany({ where: { userId: { in: doomedEmployerIds } } }),
        ),
      );
      record(
        'ProfileView',
        await countOrDelete(
          EXECUTE,
          () => tx.profileView.count({ where: { employerId: { in: doomedEmployerIds } } }),
          () => tx.profileView.deleteMany({ where: { employerId: { in: doomedEmployerIds } } }),
        ),
      );
      record(
        'Notification',
        await countOrDelete(
          EXECUTE,
          () => tx.notification.count({ where: { userId: { in: doomedEmployerIds } } }),
          () => tx.notification.deleteMany({ where: { userId: { in: doomedEmployerIds } } }),
        ),
      );
      // TermsAcceptance is ON DELETE CASCADE from User — not deleted here on
      // purpose, it goes automatically when the User row does. Reported for
      // visibility only.
      record(
        'TermsAcceptance (auto-cascade, not deleted explicitly)',
        await tx.termsAcceptance.count({ where: { userId: { in: doomedEmployerIds } } }),
      );

      if (RESOLVE_EMPLOYER_CANDIDATE_PROFILE_CONFLICT) {
        record(
          'CandidateProfile (empty employer-owned shell, explicit opt-in only)',
          await countOrDelete(
            EXECUTE,
            () => tx.candidateProfile.count({ where: { userId: { in: doomedEmployerIds } } }),
            () => tx.candidateProfile.deleteMany({ where: { userId: { in: doomedEmployerIds } } }),
          ),
        );
      }

      record(
        'User (employer)',
        await countOrDelete(EXECUTE, () => tx.user.count({ where: { id: { in: doomedEmployerIds } } }), () =>
          tx.user.deleteMany({ where: { id: { in: doomedEmployerIds } } }),
        ),
      );

      // ================= PHASE 3: the orgs themselves =================

      record(
        'Organization',
        await countOrDelete(EXECUTE, () => tx.organization.count({ where: { id: { in: deletedOrgIds } } }), () =>
          tx.organization.deleteMany({ where: { id: { in: deletedOrgIds } } }),
        ),
      );

      // ================= PHASE 4: blanket Attempt/Badge (org-independent) =================

      const badges = await tx.badge.findMany({ select: { id: true } });
      const badgeIds = badges.map((b) => b.id);

      const affectedClaims = await tx.skillClaim.findMany({
        where: { badgeId: { in: badgeIds } },
        select: { id: true },
      });
      const affectedClaimIds = affectedClaims.map((c) => c.id);

      if (SKILL_CLAIM_STRATEGY === 'DELETE') {
        record(
          'SkillClaim (deleted)',
          await countOrDelete(
            EXECUTE,
            () => tx.skillClaim.count({ where: { id: { in: affectedClaimIds } } }),
            () => tx.skillClaim.deleteMany({ where: { id: { in: affectedClaimIds } } }),
          ),
        );
      } else {
        record('SkillClaim (reverted to UNVERIFIED)', affectedClaimIds.length);
        if (EXECUTE && affectedClaimIds.length > 0) {
          await tx.skillClaim.updateMany({
            where: { id: { in: affectedClaimIds } },
            data: { badgeId: null, status: 'UNVERIFIED' },
          });
        }
      }

      const attempts = await tx.attempt.findMany({ select: { id: true } });
      const attemptIds = attempts.map((a) => a.id);

      record(
        'AttemptAnswer',
        await countOrDelete(
          EXECUTE,
          () => tx.attemptAnswer.count({ where: { attemptId: { in: attemptIds } } }),
          () => tx.attemptAnswer.deleteMany({ where: { attemptId: { in: attemptIds } } }),
        ),
      );
      record(
        'IntegrityEvent',
        await countOrDelete(
          EXECUTE,
          () => tx.integrityEvent.count({ where: { attemptId: { in: attemptIds } } }),
          () => tx.integrityEvent.deleteMany({ where: { attemptId: { in: attemptIds } } }),
        ),
      );
      record(
        'QuestionServedAt',
        await countOrDelete(
          EXECUTE,
          () => tx.questionServedAt.count({ where: { attemptId: { in: attemptIds } } }),
          () => tx.questionServedAt.deleteMany({ where: { attemptId: { in: attemptIds } } }),
        ),
      );
      record(
        'Badge',
        await countOrDelete(EXECUTE, () => tx.badge.count({ where: { id: { in: badgeIds } } }), () =>
          tx.badge.deleteMany({ where: { id: { in: badgeIds } } }),
        ),
      );
      record(
        'Attempt',
        await countOrDelete(EXECUTE, () => tx.attempt.count({ where: { id: { in: attemptIds } } }), () =>
          tx.attempt.deleteMany({ where: { id: { in: attemptIds } } }),
        ),
      );
    },
    { timeout: 60_000 },
  );

  console.log(EXECUTE ? 'Deleted:' : 'Would delete:');
  const width = Math.max(...Object.keys(counts).map((k) => k.length));
  for (const [table, n] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(width)}  ${n}`);
  }

  if (!EXECUTE) {
    console.log('');
    console.log('Dry run only — nothing was deleted. Re-run with --execute to actually delete.');
  }
}

/**
 * In dry-run mode, runs [doCount] and returns the matching row count
 * without deleting anything. In execute mode, runs [doDelete] instead and
 * returns how many rows were actually removed. Takes lazy closures (not a
 * shared Prisma delegate + where object) so every call site keeps its own
 * concrete model type — a generic `{ count, deleteMany }` parameter typed
 * loosely enough to accept every model doesn't type-check under this
 * project's strict tsconfig (Prisma's generated `where` types are
 * model-specific, not a common shape). Kept as one helper anyway so every
 * table goes through the exact same dry-run/execute branch — no risk of a
 * deleteMany call being added without its dry-run counterpart.
 */
async function countOrDelete(
  execute: boolean,
  doCount: () => Promise<number>,
  doDelete: () => Promise<{ count: number }>,
): Promise<number> {
  if (!execute) return doCount();
  const { count } = await doDelete();
  return count;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
