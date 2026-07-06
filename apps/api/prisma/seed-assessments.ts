// Seeds a sample "RAG Systems" MCQ assessment so you can test the full flow.
// Run from apps/api:  npx ts-node prisma/seed-assessments.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const questions = [
  {
    text: 'In a RAG pipeline, what is the primary purpose of the retrieval step?',
    options: [
      'To fine-tune the model on domain data',
      'To fetch relevant context from a knowledge store to ground the generation',
      'To compress the prompt so it fits the context window',
      'To rank the model\'s outputs by quality',
    ],
    answer: 1,
  },
  {
    text: 'Why is chunk overlap commonly used when splitting documents for embedding?',
    options: [
      'It reduces total storage requirements',
      'It makes embeddings cheaper to compute',
      'It preserves context that would otherwise be cut at chunk boundaries',
      'It guarantees exact keyword matches',
    ],
    answer: 2,
  },
  {
    text: 'What does "hybrid search" typically combine?',
    options: [
      'Two different LLMs voting on answers',
      'Dense vector similarity search with sparse keyword search (e.g. BM25)',
      'Retrieval from two separate vector databases',
      'Semantic caching with prompt caching',
    ],
    answer: 1,
  },
  {
    text: 'A reranker in a RAG system is used to:',
    options: [
      'Re-order retrieved candidates by relevance using a more precise (usually cross-encoder) model',
      'Shuffle results to reduce position bias in the LLM',
      'Re-embed the query with a larger model',
      'Sort documents by recency',
    ],
    answer: 0,
  },
  {
    text: 'Your RAG system retrieves relevant documents, but the model still answers from its own stale knowledge. Which is the most direct mitigation?',
    options: [
      'Increase the number of retrieved chunks',
      'Instruct the model to answer only from the provided context and cite it',
      'Switch to a larger embedding model',
      'Lower the temperature to 0',
    ],
    answer: 1,
  },
  {
    text: 'Which metric pair best evaluates the two halves of a RAG system separately?',
    options: [
      'BLEU for retrieval, ROUGE for generation',
      'Latency for retrieval, cost for generation',
      'Retrieval recall/precision for the retriever, faithfulness/groundedness for the generator',
      'Token count for both',
    ],
    answer: 2,
  },
];

async function main() {
  const skill = await prisma.skill.findFirst({ where: { name: 'RAG Systems' } });
  if (!skill) throw new Error('Run the taxonomy seed first (npm run prisma:seed)');

  const existing = await prisma.assessment.findFirst({
    where: { title: 'RAG Systems Fundamentals' },
  });
  if (existing) {
    console.log('Sample assessment already exists, skipping.');
    return;
  }

  const assessment = await prisma.assessment.create({
    data: {
      skillId: skill.id,
      title: 'RAG Systems Fundamentals',
      targetLevel: 'L2',
      durationMins: 15,
      passThreshold: 70,
      isPremium: false,
      isLive: true,
      questions: {
        create: questions.map((q, i) => ({
          type: 'MCQ',
          body: { text: q.text, options: q.options },
          correct: { answer: q.answer },
          difficulty: 2 + (i % 2),
          isLive: true,
        })),
      },
    },
  });
  console.log(`Seeded assessment "${assessment.title}" with ${questions.length} questions.`);
}

main().finally(() => prisma.$disconnect());
