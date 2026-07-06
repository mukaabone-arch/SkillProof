// Seed the Phase 1 taxonomy. Run: npm run prisma:seed
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const taxonomy: Record<string, { name: string; aliases: string[] }[]> = {
  'LLM Engineering': [
    { name: 'RAG Systems', aliases: ['retrieval augmented generation', 'langchain', 'llamaindex'] },
    { name: 'Prompt Engineering', aliases: ['prompting', 'prompt design'] },
    { name: 'LLM Evaluation', aliases: ['evals', 'llm-as-judge'] },
  ],
  'Model Training': [
    { name: 'Fine-tuning & SFT', aliases: ['sft', 'lora', 'peft', 'supervised fine-tuning'] },
    { name: 'RLHF & Alignment', aliases: ['rlhf', 'dpo'] },
  ],
  'Agentic Systems': [
    { name: 'Tool Use & Orchestration', aliases: ['function calling', 'mcp', 'agents'] },
  ],
  'MLOps': [
    { name: 'Model Deployment', aliases: ['serving', 'inference', 'vllm'] },
    { name: 'ML Monitoring', aliases: ['drift detection', 'observability'] },
  ],
  'Classical ML': [
    { name: 'Supervised Learning', aliases: ['xgboost', 'scikit-learn', 'regression', 'classification'] },
    { name: 'Feature Engineering', aliases: ['feature selection'] },
  ],
  'Data Engineering': [
    { name: 'Data Pipelines', aliases: ['etl', 'airflow', 'spark'] },
    { name: 'Vector Stores', aliases: ['pgvector', 'pinecone', 'embeddings'] },
  ],
};

async function main() {
  let order = 0;
  for (const [domainName, skills] of Object.entries(taxonomy)) {
    const domain = await prisma.domain.upsert({
      where: { name: domainName },
      update: {},
      create: { name: domainName, sortOrder: order++ },
    });
    for (const s of skills) {
      await prisma.skill.upsert({
        where: { domainId_name: { domainId: domain.id, name: s.name } },
        update: { aliases: s.aliases },
        create: { domainId: domain.id, name: s.name, aliases: s.aliases },
      });
    }
  }
  console.log('Taxonomy seeded.');
}

main().finally(() => prisma.$disconnect());
