import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { indexKnowledge } from '../../src/retrieval/indexer.js'
import { findLeakage, normalizeQuestion } from '../../src/retrieval/leakage.js'
import { createMockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'

// Leakage guard (IMPLEMENTATION.md 20.2) against verified examples in querycraft_test.

vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')

const provider = createMockEmbeddingProvider()
const embeddings = createEmbeddingsClient(provider)

beforeAll(async () => {
  await getAppPool().query('TRUNCATE schema_tables, examples, glossary_terms, daily_usage')
  await indexKnowledge(
    {
      schema: { tables: [] },
      descriptions: {},
      examples: [
        { question: 'How many sales orders are there in total?', sql: 'SELECT count(*) FROM sales.salesorderheader' },
        { question: 'Which vendors are preferred?', sql: 'SELECT name FROM purchasing.vendor WHERE preferredvendorstatus' },
      ],
      glossary: [],
    },
    embeddings,
  )
  await getAppPool().query(
    "INSERT INTO examples (question, sql, status, source) VALUES ('List every product color', 'SELECT 1', 'pending', 'feedback')",
  )
})

afterAll(async () => {
  await closeAppPool()
})

describe('normalizeQuestion', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeQuestion('  How MANY sales-orders, in total?? ')).toBe('how many sales orders in total')
  })
})

describe('findLeakage', () => {
  it('flags a normalized text match without any embedding call', async () => {
    const before = provider.requests
    const matches = await findLeakage(['how many SALES orders are there in total'], embeddings, 'eval')
    expect(matches).toEqual([
      expect.objectContaining({ reason: 'text', exampleQuestion: 'How many sales orders are there in total?', similarity: 1 }),
    ])
    expect(provider.requests).toBe(before)
  })

  it('flags a reworded question with cosine similarity ≥ 0.95', async () => {
    const matches = await findLeakage(['In total, how many sales orders are there?'], embeddings, 'eval')
    expect(matches).toHaveLength(1)
    expect(matches[0]?.reason).toBe('similarity')
    expect(matches[0]?.similarity).toBeGreaterThanOrEqual(0.95)
  })

  it('passes unrelated questions and embeds them in one request', async () => {
    const before = provider.requests
    const matches = await findLeakage(
      ['What is the average list price of helmets?', 'Which territory had the most returns?'],
      embeddings,
      'eval',
    )
    expect(matches).toEqual([])
    expect(provider.requests - before).toBe(1)
  })

  it('ignores examples that are not verified', async () => {
    expect(await findLeakage(['List every product color'], embeddings, 'eval')).toEqual([])
  })

  it('applies the given threshold', async () => {
    // All 6 words appear in the 8-word example: cosine = 6/√48 ≈ 0.87, below 0.95.
    const question = 'How many sales orders are there?'
    expect(await findLeakage([question], embeddings, 'eval')).toEqual([])
    expect(await findLeakage([question], embeddings, 'eval', 0.8)).toHaveLength(1)
  })
})
