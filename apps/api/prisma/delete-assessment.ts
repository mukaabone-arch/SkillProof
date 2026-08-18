import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error('Pass the assessment id as an argument.');

  const a = await prisma.assessment.findUnique({ where: { id } });
  if (!a) {
    console.log(`No assessment with id ${id}. Nothing deleted.`);
    return;
  }

  const attempts = await prisma.attempt.findMany({
    where: { assessmentId: id },
    select: { id: true },
  });
  const attemptIds = attempts.map((x) => x.id);

  if (attemptIds.length) {
    // Detach a nullable referencing row we keep:
    await prisma.assessmentRequest.updateMany({
      where: { attemptId: { in: attemptIds } },
      data: { attemptId: null },
    });
    // Delete children of Attempt before the attempts themselves:
    await prisma.integrityEvent.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await prisma.questionServedAt.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await prisma.attemptAnswer.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await prisma.badge.deleteMany({ where: { attemptId: { in: attemptIds } } });
    await prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } });
  }

  const q = await prisma.question.deleteMany({ where: { assessmentId: id } });
  await prisma.assessment.delete({ where: { id } });

  console.log(`Deleted "${a.title}" (${id}): ${q.count} questions, ${attemptIds.length} attempt(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
