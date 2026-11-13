import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { closeReaderPool, getReaderPool } from '../../src/db/reader.js'
import {
  examplesFileSchema,
  glossaryFileSchema,
  readSeedFile,
  schemaFileSchema,
  seedPath,
  valueColumnsFileSchema,
} from '../../src/kb/seed-files.js'
import { loadColumnValues } from '../../src/kb/values.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { indexKnowledge } from '../../src/retrieval/indexer.js'
import { createMockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import {
  EXAMPLE_TOP_K,
  GLOSSARY_MIN_SIMILARITY,
  GLOSSARY_TOP_K,
  MAX_TABLES,
  retrieveContext,
} from '../../src/services/retrieval.service.js'

// Retrieval over the real seed knowledge base, indexed with deterministic mock
// embeddings in querycraft_test (IMPLEMENTATION.md 11.3, M2 acceptance).

vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')

const provider = createMockEmbeddingProvider()
const embeddings = createEmbeddingsClient(provider)
const schema = await readSeedFile(seedPath.schema, schemaFileSchema)
const seedExamples = await readSeedFile(seedPath.examples, examplesFileSchema)

const DEPARTMENT_QUESTION = 'How many employees currently work in each department?'

beforeAll(async () => {
  await getAppPool().query('TRUNCATE schema_tables, examples, glossary_terms, column_values, daily_usage')
  // Descriptions that name the table, so word overlap drives the mock similarity.
  const descriptions = Object.fromEntries(
    schema.tables.map((t) => [`${t.schema}.${t.table}`, `The ${t.table} table of the ${t.schema} schema`]),
  )
  await indexKnowledge(
    { schema, descriptions, examples: seedExamples, glossary: await readSeedFile(seedPath.glossary, glossaryFileSchema) },
    embeddings,
  )
  await loadColumnValues(getReaderPool(), await readSeedFile(seedPath.valueColumns, valueColumnsFileSchema), schema)
})

beforeEach(async () => {
  await getAppPool().query("DELETE FROM examples WHERE source <> 'seed'")
})

afterAll(async () => {
  await closeReaderPool()
  await closeAppPool()
})

describe('retrieveContext', () => {
  it('makes exactly one embedding call per question', async () => {
    const before = provider.requests
    await retrieveContext('What was the total revenue for each calendar year?', embeddings, 'app')
    expect(provider.requests - before).toBe(1)
  })

  it('returns the matching verified example first, with its tables added', async () => {
    const context = await retrieveContext(DEPARTMENT_QUESTION, embeddings, 'app')
    expect(context.examples).toHaveLength(EXAMPLE_TOP_K)
    expect(context.examples[0]?.question).toBe(DEPARTMENT_QUESTION)
    expect(context.examples[0]?.similarity).toBeCloseTo(1, 5)
    const names = context.tables.map((t) => `${t.schema}.${t.table}`)
    expect(names).toContain('humanresources.employeedepartmenthistory')
    expect(names).toContain('humanresources.department')
    expect(names.length).toBeLessThanOrEqual(MAX_TABLES)
    expect(new Set(names).size).toBe(names.length)
  })

  it('never returns pending or rejected examples, even when they match exactly', async () => {
    await getAppPool().query(
      `INSERT INTO examples (question, sql, status, source, embedding)
       SELECT $1, 'SELECT 1', s.status::example_status, 'feedback', e.embedding
         FROM (VALUES ('pending'), ('rejected')) AS s(status),
              (SELECT embedding FROM examples WHERE question = $2) AS e`,
      ['How many employees work in each department right now?', DEPARTMENT_QUESTION],
    )
    const context = await retrieveContext('How many employees work in each department right now?', embeddings, 'app')
    const ids = await getAppPool().query<{ id: string }>("SELECT id FROM examples WHERE status = 'verified'")
    const verified = new Set(ids.rows.map((r) => r.id))
    expect(context.examples.length).toBeGreaterThan(0)
    expect(context.examples.every((e) => verified.has(e.id))).toBe(true)
    expect(context.examples.every((e) => e.sql !== 'SELECT 1')).toBe(true)
  })

  it('returns at most 8 tables by similarity plus example tables, never more than 12', async () => {
    const context = await retrieveContext('Show revenue by sales territory and product category', embeddings, 'app')
    const ranked = context.tables.filter((t) => t.similarity !== null)
    expect(ranked.length).toBe(8)
    expect(context.tables.length).toBeLessThanOrEqual(MAX_TABLES)
    const similarities = ranked.map((t) => t.similarity ?? 0)
    expect(similarities).toEqual([...similarities].sort((a, b) => b - a))
  })

  it('removes denied columns from retrieved tables', async () => {
    const context = await retrieveContext('creditcard table of the sales schema', embeddings, 'app')
    const creditcard = context.tables.find((t) => t.schema === 'sales' && t.table === 'creditcard')
    expect(creditcard).toBeDefined()
    expect(creditcard?.columns.map((c) => c.name)).not.toContain('cardnumber')
    expect(context.tables.every((t) => t.columns.every((c) => !c.denied))).toBe(true)
  })

  it('returns glossary terms only at or above the similarity threshold, at most 5', async () => {
    const context = await retrieveContext('What was the revenue in each fiscal year?', embeddings, 'app')
    expect(context.glossary.length).toBeGreaterThan(0)
    expect(context.glossary.length).toBeLessThanOrEqual(GLOSSARY_TOP_K)
    expect(context.glossary.every((g) => g.similarity >= GLOSSARY_MIN_SIMILARITY)).toBe(true)
    expect(context.glossary.map((g) => g.term)).toContain('fiscal year')

    const unrelated = await retrieveContext('zebra quantum xylophone', embeddings, 'app')
    expect(unrelated.glossary).toEqual([])
  })

  it('includes stored values for misspelled terms', async () => {
    const context = await retrieveContext('Revenue from customers in Germny', embeddings, 'app')
    expect(context.values.map((v) => v.value)).toContain('Germany')
  })

  it('is deterministic with the mock embeddings', async () => {
    const a = await retrieveContext('Which bikes have a list price above 2000?', embeddings, 'app')
    const b = await retrieveContext('Which bikes have a list price above 2000?', embeddings, 'app')
    expect(b).toEqual(a)
  })
})
