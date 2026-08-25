// Imports the 900-question MCQ archive (36 .xlsx files, one per skill+level)
// into the assessment module. Run from apps/api:
//   npx ts-node prisma/seed-mcq-import.ts
//
// Re-runnable and idempotent: skips any (skill, level) assessment that
// already exists by title, and within an existing assessment skips any
// question whose source "Question ID" is already present (recovers a
// partial/crashed run cleanly). Safe to run against an already-imported DB.
//
// CRITICAL: every source question has "A" as the correct answer verbatim —
// importing as-is would make every assessment trivially gameable. Each
// question's four options are shuffled with a seeded PRNG (see shuffleSeed
// below) before storage, and the correct answer's new position is
// recomputed and stored instead of the source's. The shuffle is
// deterministic (same seed, same file-then-row processing order) so
// re-running reproduces byte-identical results.
//
// Source columns: Question ID, Skill, Level, Question, Option A-D,
// Correct Answer, Explanation, Topic. One file
// (Batch1_Worksheet1_LLM_Evaluation_Foundation_25_MCQs.xlsx) has no Topic
// column — handled by treating a missing Topic as null, not failing.
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient, SkillLevel } from '@prisma/client';

const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, 'data', 'mcq-import');

/**
 * Reconciled against the existing taxonomy (prisma/seed.ts + a live-DB
 * check) before writing anything — see the import's own report for the
 * full reasoning. 9 of these 12 already exist under this exact name
 * (verbatim — no near-miss aliasing needed, e.g. "Fine-tuning & SFT" is
 * already the real name, not "Fine-tuning"). 3 are genuinely new skills
 * and need a domain: "AI Agents & Multi-Agent Systems" fits the existing
 * "Agentic Systems" domain (alongside Tool Use & Orchestration); the other
 * two don't fit any existing domain and share a new one, "AI Governance &
 * Architecture" — a judgment call, flagged as such in the report.
 */
const SKILL_PLAN: Record<string, { domain: string } | null> = {
  'RAG Systems': null,
  'Prompt Engineering': null,
  'LLM Evaluation': null,
  'Fine-tuning & SFT': null,
  'RLHF & Alignment': null,
  'Tool Use & Orchestration': null,
  'Model Deployment': null,
  'ML Monitoring': null,
  'Feature Engineering': null,
  'Supervised Learning': null,
  'Data Pipelines': null,
  'Vector Stores': null,
  'AI Agents & Multi-Agent Systems': { domain: 'Agentic Systems' },
  'AI Architecture & Enterprise GenAI': { domain: 'AI Governance & Architecture' },
  'AI Security & Responsible AI': { domain: 'AI Governance & Architecture' },
};

/**
 * Source levels -> this system's SkillLevel ladder. Verified against
 * apps/web/app/assessments/page.tsx's LEVEL_INFO (the one place the human
 * names are bound to L1-L4): L1 Foundational, L2 Practitioner, L3 Advanced,
 * L4 Expert. The source has no "Expert" tier, so L4 is simply never
 * targeted by this import — that's expected, not a gap to fill.
 */
const LEVEL_MAP: Record<string, SkillLevel> = {
  Foundation: SkillLevel.L1,
  Practitioner: SkillLevel.L2,
  Advanced: SkillLevel.L3,
};
const LEVEL_DISPLAY: Record<SkillLevel, string> = {
  L1: 'Foundational',
  L2: 'Practitioner',
  L3: 'Advanced',
  L4: 'Expert',
};
/** Difficulty mirrors the source's own level, matching the ascending-rigor intent of L1 < L2 < L3. */
const LEVEL_DIFFICULTY: Record<SkillLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4 };

/**
 * skill|level pairs that already have a live assessment in the dev DB
 * (checked directly, not assumed — see the import report):
 *   RAG Systems|L2         "RAG Systems Fundamentals"   24 questions, 14 attempts, 2 badges issued
 *   Prompt Engineering|L1  "Prompt Engineer Test"        2 questions, 25 attempts, 2 badges issued
 *   Fine-tuning & SFT|L1   "Fine-tuning Smoke Test"      0 questions,  0 attempts, 0 badges (inert, but still live)
 * For these three, the imported 25-question set is written as its own
 * *separate*, non-live assessment ("(Imported MCQ Bank)") rather than
 * touching the existing one — it exists in the DB, fully usable, but
 * never appears in the candidate-facing catalog until a human flips
 * isLive, so real attempts/badges on the existing assessment are
 * completely unaffected. (A second *live* assessment at the same
 * skill+level would also be silently unreachable: the catalog picks
 * `formats.find(f => f.type === 'TEST')`, i.e. whichever was created
 * first — so making it live here wouldn't even surface it to candidates.)
 * Every other skill+level pair has no existing assessment at all, so it
 * imports live and reachable immediately.
 */
const COLLISIONS = new Set(['RAG Systems|L2', 'Prompt Engineering|L1', 'Fine-tuning & SFT|L1']);

interface SourceRow {
  questionId: string;
  skill: string;
  level: string;
  question: string;
  options: [string, string, string, string];
  correctAnswer: string;
  explanation: string | null;
  topic: string | null;
}

function readRows(filePath: string): SourceRow[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  return raw.map((r, i) => {
    const get = (key: string): string | null => {
      const v = r[key];
      return v == null ? null : String(v).trim();
    };
    const questionId = get('Question ID');
    const skill = get('Skill');
    const level = get('Level');
    const question = get('Question');
    const a = get('Option A');
    const b = get('Option B');
    const c = get('Option C');
    const d = get('Option D');
    const correctAnswer = get('Correct Answer');
    if (!questionId || !skill || !level || !question || !a || !b || !c || !d || !correctAnswer) {
      throw new Error(`${path.basename(filePath)} row ${i + 2}: missing a required column`);
    }
    return {
      questionId,
      skill,
      level,
      question,
      options: [a, b, c, d],
      correctAnswer,
      explanation: get('Explanation'),
      // Batch1_Worksheet1_LLM_Evaluation_Foundation_25_MCQs.xlsx has no Topic
      // column at all — get() returns null for a missing key exactly like it
      // does for a present-but-empty cell, so this needs no special case.
      topic: get('Topic'),
    };
  });
}

/**
 * mulberry32 — small, fast, seeded PRNG (public domain). Deterministic:
 * same seed + same call sequence => same output sequence, every run.
 * One instance is created per import run and advanced sequentially across
 * every row in a fixed order (files sorted by filename, rows in file
 * order), so re-running the script reshuffles identically.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SHUFFLE_SEED = 900925; // fixed — do not change without expecting every question's option order to shift

/** Fisher-Yates over indices [0,1,2,3], returning the shuffled option strings and the new index of whatever was originally at position 0 (the always-correct "A"). */
function shuffleOptions(
  options: [string, string, string, string],
  rand: () => number,
): { shuffled: string[]; newCorrectIndex: number } {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const shuffled = order.map((originalIndex) => options[originalIndex]);
  const newCorrectIndex = order.indexOf(0);
  return { shuffled, newCorrectIndex };
}

async function ensureSkill(name: string): Promise<{ id: string }> {
  const plan = SKILL_PLAN[name];
  if (plan === null) {
    const skill = await prisma.skill.findFirst({ where: { name } });
    if (!skill) throw new Error(`Expected existing skill "${name}" not found — run prisma:seed first.`);
    return skill;
  }
  const domain = await prisma.domain.upsert({
    where: { name: plan.domain },
    update: {},
    create: { name: plan.domain, sortOrder: 100 }, // after the original taxonomy's own sort orders
  });
  return prisma.skill.upsert({
    where: { domainId_name: { domainId: domain.id, name } },
    update: {},
    create: { domainId: domain.id, name, aliases: [] },
  });
}

/** Newly-created assessments serve this many of each bank's 25 questions per attempt.
 * Was 20 (80% of the bank) — a retaking candidate saw the same paper almost every time.
 * 15 gives genuine variation between attempts while still covering 60% of the bank. */
const QUESTIONS_PER_ATTEMPT = 15;

async function importFile(
  filePath: string,
  rand: () => number,
): Promise<{ inserted: number; skipped: number; positions: number[]; questionsPerAttemptCorrected: boolean }> {
  const rows = readRows(filePath);
  const fileName = path.basename(filePath);
  const skillName = rows[0].skill;
  const sourceLevel = rows[0].level;
  for (const r of rows) {
    if (r.skill !== skillName || r.level !== sourceLevel) {
      throw new Error(`${fileName}: inconsistent Skill/Level within one file (expected ${skillName}/${sourceLevel}, saw ${r.skill}/${r.level})`);
    }
  }
  if (!(skillName in SKILL_PLAN)) throw new Error(`${fileName}: unrecognized skill "${skillName}"`);
  const targetLevel = LEVEL_MAP[sourceLevel];
  if (!targetLevel) throw new Error(`${fileName}: unrecognized level "${sourceLevel}"`);

  const skill = await ensureSkill(skillName);
  const collision = COLLISIONS.has(`${skillName}|${targetLevel}`);
  const title = collision
    ? `${skillName} ${LEVEL_DISPLAY[targetLevel]} (Imported MCQ Bank)`
    : `${skillName} ${LEVEL_DISPLAY[targetLevel]}`;

  let assessment = await prisma.assessment.findFirst({ where: { title } });
  let questionsPerAttemptCorrected = false;
  if (!assessment) {
    assessment = await prisma.assessment.create({
      data: {
        skillId: skill.id,
        title,
        targetLevel,
        durationMins: 30,
        passThreshold: 70,
        questionsPerAttempt: QUESTIONS_PER_ATTEMPT,
        isPremium: false,
        isLive: !collision,
      },
    });
  } else if (assessment.questionsPerAttempt !== QUESTIONS_PER_ATTEMPT) {
    // Re-running against a DB imported before the 20->15 change: this
    // title is only ever produced by this script (see the `title` computed
    // above), so correcting it here can never touch the three pre-existing,
    // differently-named assessments this import deliberately left alone
    // (RAG Systems Fundamentals L2, Prompt Engineer Test L1, Fine-tuning
    // Smoke Test L1 — see the COLLISIONS comment).
    assessment = await prisma.assessment.update({
      where: { id: assessment.id },
      data: { questionsPerAttempt: QUESTIONS_PER_ATTEMPT },
    });
    questionsPerAttemptCorrected = true;
  }

  const existingQuestions = await prisma.question.findMany({
    where: { assessmentId: assessment.id },
    select: { correct: true },
  });
  const existingSourceIds = new Set(
    existingQuestions.map((q) => (q.correct as { sourceId?: string })?.sourceId).filter((v): v is string => !!v),
  );

  let inserted = 0;
  let skipped = 0;
  const positions: number[] = [];
  for (const row of rows) {
    if (existingSourceIds.has(row.questionId)) {
      skipped += 1;
      continue;
    }
    // Every source Correct Answer is "A" (index 0 into [A,B,C,D]) — verified
    // across all 900 rows before writing this script. Guard it anyway: a
    // row that ever isn't "A" would silently corrupt the shuffle's premise.
    if (row.correctAnswer.trim().toUpperCase() !== 'A') {
      throw new Error(`${fileName} ${row.questionId}: expected source Correct Answer "A", got "${row.correctAnswer}"`);
    }
    const { shuffled, newCorrectIndex } = shuffleOptions(row.options, rand);
    await prisma.question.create({
      data: {
        assessmentId: assessment.id,
        type: 'MCQ',
        body: { text: row.question, options: shuffled },
        correct: {
          answer: newCorrectIndex,
          sourceId: row.questionId,
          explanation: row.explanation,
          topic: row.topic,
        },
        difficulty: LEVEL_DIFFICULTY[targetLevel],
        isLive: true,
      },
    });
    inserted += 1;
    positions.push(newCorrectIndex);
  }

  return { inserted, skipped, positions, questionsPerAttemptCorrected };
}

async function main() {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.xlsx'))
    .sort();

  const rand = mulberry32(SHUFFLE_SEED);
  const allPositions: number[] = [];
  const perAssessment: { file: string; skill: string; level: string; inserted: number; skipped: number }[] = [];
  let questionsPerAttemptCorrectedCount = 0;

  for (const file of files) {
    const rows = readRows(path.join(DATA_DIR, file));
    const { inserted, skipped, positions, questionsPerAttemptCorrected } = await importFile(path.join(DATA_DIR, file), rand);
    allPositions.push(...positions);
    perAssessment.push({
      file,
      skill: rows[0].skill,
      level: rows[0].level,
      inserted,
      skipped,
    });
    if (questionsPerAttemptCorrected) questionsPerAttemptCorrectedCount += 1;
    console.log(`${file}: inserted ${inserted}, skipped ${skipped} (already present)`);
  }

  console.log(
    `\n--- questionsPerAttempt correction ---\n${questionsPerAttemptCorrectedCount} existing imported assessment(s) corrected from 20 to ${QUESTIONS_PER_ATTEMPT}.`,
  );

  console.log('\n--- Per skill/level ---');
  for (const p of perAssessment) {
    console.log(`${p.skill} | ${p.level} -> inserted=${p.inserted} skipped=${p.skipped}`);
  }

  const dist = [0, 0, 0, 0];
  allPositions.forEach((p) => dist[p]++);
  console.log('\n--- Correct-answer position distribution (this run\'s newly-inserted questions) ---');
  console.log(`A(0): ${dist[0]}  B(1): ${dist[1]}  C(2): ${dist[2]}  D(3): ${dist[3]}  (total ${allPositions.length})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
