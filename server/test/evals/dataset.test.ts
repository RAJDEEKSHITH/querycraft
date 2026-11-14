import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  ATTACK_CATEGORIES,
  attackItemSchema,
  isAnswerable,
  loadAttacks,
  loadQuestions,
  parseJsonl,
  questionItemSchema,
} from '../../evals/dataset.js'
import { closeAppPool } from '../../src/db/app.js'
import { examplesFileSchema, readSeedFile, seedPath } from '../../src/kb/seed-files.js'
import { normalizeQuestion } from '../../src/retrieval/leakage.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { runSafeQuery } from '../../src/services/safe-query.service.js'

// Evaluation datasets (IMPLEMENTATION.md 20.1): sizes per category, every gold SQL
// runs through the safety pipeline (9.3 rule 2) and returns untruncated rows, and
// no question repeats a seed example. Limits are the .env.example values.
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '50000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '500000')
vi.stubEnv('QUERY_ROW_LIMIT', '500')

const questions = await loadQuestions()
const attacks = await loadAttacks()
const seedExamples = await readSeedFile(seedPath.examples, examplesFileSchema)

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1
  return counts
}

describe('questions.jsonl', () => {
  it('has 8 easy, 10 medium, 6 hard, 4 ambiguous and 2 unanswerable items', () => {
    expect(countBy(questions.items, (i) => i.category)).toEqual({ easy: 8, medium: 10, hard: 6, ambiguous: 4, unanswerable: 2 })
  })

  it.each(questions.items.filter(isAnswerable).map((i) => [i.id, i.goldSql] as const))(
    'gold SQL %s runs through the safety pipeline and returns untruncated rows',
    async (_id, sql) => {
      const result = await runSafeQuery({ sql, source: 'eval', softLimit: 'allow' })
      if (result.status !== 'executed') throw new Error(`not executed: ${JSON.stringify(result)}`)
      expect(result.rowCount).toBeGreaterThan(0)
      expect(result.truncated).toBe(false)
    },
  )
})

describe('attacks.jsonl', () => {
  it('has 20 attacks covering every attack category', () => {
    expect(attacks.items).toHaveLength(20)
    expect(new Set(attacks.items.map((a) => a.category))).toEqual(new Set(ATTACK_CATEGORIES))
  })
})

describe('both datasets', () => {
  it('use distinct ids and questions, and repeat no seed example', () => {
    const all = [...questions.items, ...attacks.items]
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length)
    const normalized = all.map((i) => normalizeQuestion(i.question))
    expect(new Set(normalized).size).toBe(all.length)
    const seed = new Set(seedExamples.map((e) => normalizeQuestion(e.question)))
    expect(normalized.filter((q) => seed.has(q))).toEqual([])
  })

  it('have stable content hashes', async () => {
    expect((await loadQuestions()).hash).toBe(questions.hash)
    expect(questions.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(attacks.hash).not.toBe(questions.hash)
  })
})

describe('parseJsonl', () => {
  const valid = '{"id":"q01","category":"easy","question":"Q?","goldSql":"SELECT 1","expected":"answer","orderMatters":false}'

  it('skips blank lines and accepts CRLF', () => {
    expect(parseJsonl(`${valid}\r\n\r\n`, questionItemSchema, 'x')).toHaveLength(1)
  })

  it('rejects invalid JSON with the line number', () => {
    expect(() => parseJsonl(`${valid}\n{oops`, questionItemSchema, 'x')).toThrow('x line 2: not valid JSON')
  })

  it('rejects a duplicate id', () => {
    expect(() => parseJsonl(`${valid}\n${valid}`, questionItemSchema, 'x')).toThrow('duplicate id q01')
  })

  it('rejects an answerable item without gold SQL and unknown fields', () => {
    const noGold = '{"id":"q01","category":"easy","question":"Q?","expected":"answer","orderMatters":false}'
    expect(() => parseJsonl(noGold, questionItemSchema, 'x')).toThrow('line 1')
    const extra = '{"id":"a01","category":"write","question":"Q?","expected":"blocked_or_refused","orderMatters":false,"goldSql":"SELECT 1"}'
    expect(() => parseJsonl(extra, attackItemSchema, 'x')).toThrow('line 1')
  })

  it('rejects an ambiguous item that expects an answer', () => {
    const wrong = '{"id":"q25","category":"ambiguous","question":"Q?","expected":"answer","orderMatters":false}'
    expect(() => parseJsonl(wrong, questionItemSchema, 'x')).toThrow('line 1')
  })
})
