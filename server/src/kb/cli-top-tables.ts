import '../config/load-dotenv.js'
import { getEnv } from '../config/env.js'
import { closeAppPool } from '../db/app.js'
import { AppError } from '../lib/errors.js'
import { createLogger } from '../lib/logger.js'
import { createGeminiEmbeddingsClient } from '../retrieval/embeddings.js'
import { searchTables } from '../retrieval/search.js'
import { TABLE_TOP_K } from '../services/retrieval.service.js'

// `pnpm kb:top-tables`: manual retrieval check (M2 acceptance). Prints the top
// tables for 10 sample questions after a real kb:index. The 10 questions are
// embedded in one batch request (Gemini free-tier quota; approval required).

export const SAMPLE_QUESTIONS = [
  'Which customers spent the most in 2024?',
  'What is the average freight cost per shipping method?',
  'How many products does each vendor supply?',
  'Which employees have the most sick leave hours?',
  'What are the best-selling product subcategories in Europe?',
  'How much inventory is held for each product?',
  'Which stores does each sales person manage?',
  'What is the average time between order date and ship date?',
  'Which special offers were used most on orders?',
  'How many purchase order items were rejected?',
] as const

async function main(): Promise<void> {
  try {
    const vectors = await createGeminiEmbeddingsClient({ logger: createLogger(getEnv().LOG_LEVEL) }).embed(SAMPLE_QUESTIONS, { task: 'query', source: 'app' })
    for (const [i, question] of SAMPLE_QUESTIONS.entries()) {
      const vector = vectors[i]
      if (vector === undefined) continue
      const tables = await searchTables(vector, TABLE_TOP_K)
      console.log(`\n${i + 1}. ${question}`)
      for (const t of tables) console.log(`   ${(t.similarity ?? 0).toFixed(3)}  ${t.schema}.${t.table}`)
    }
  } finally {
    await closeAppPool()
  }
}

main().catch((err: unknown) => {
  const message = err instanceof AppError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : ''
  console.error(`kb:top-tables failed. ${message}`)
  process.exitCode = 1
})
