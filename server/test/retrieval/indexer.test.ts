import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import {
  examplesFileSchema,
  glossaryFileSchema,
  readSeedFile,
  schemaFileSchema,
  seedPath,
  type TableDescriptions,
} from '../../src/kb/seed-files.js'
import { createEmbeddingsClient, MAX_EMBEDDING_BATCH } from '../../src/retrieval/embeddings.js'
import { contentHash, indexKnowledge, type KnowledgeInput } from '../../src/retrieval/indexer.js'
import { createMockEmbeddingProvider, mockVector } from '../../src/retrieval/mock-embeddings.js'

vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')

const schema = await readSeedFile(seedPath.schema, schemaFileSchema)
const seedExamples = await readSeedFile(seedPath.examples, examplesFileSchema)
const glossary = await readSeedFile(seedPath.glossary, glossaryFileSchema)
const descriptions: TableDescriptions = Object.fromEntries(
  schema.tables.map((t) => [`${t.schema}.${t.table}`, `Placeholder description of ${t.table}`]),
)

function seedInput(overrides: Partial<KnowledgeInput> = {}): KnowledgeInput {
  return { schema, descriptions, examples: seedExamples, glossary, ...overrides }
}

async function count(table: string, where = 'true'): Promise<number> {
  const result = await getAppPool().query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)
  return result.rows[0]?.n ?? -1
}

beforeEach(async () => {
  await getAppPool().query('TRUNCATE schema_tables, examples, glossary_terms, daily_usage')
})

afterAll(async () => {
  await closeAppPool()
})

describe('indexKnowledge with the real seed files', () => {
  it('embeds everything once, and makes zero embedding calls on an unchanged second run', async () => {
    const provider = createMockEmbeddingProvider()
    const client = createEmbeddingsClient(provider)
    const total = schema.tables.length + seedExamples.length + glossary.length

    const first = await indexKnowledge(seedInput(), client)
    expect(first.embedded).toBe(total)
    expect(provider.texts).toBe(total)
    expect(provider.requests).toBe(Math.ceil(total / 100))
    expect(await count('schema_tables', 'embedding IS NOT NULL')).toBe(schema.tables.length)
    expect(await count('examples', "embedding IS NOT NULL AND status = 'verified' AND source = 'seed'")).toBe(seedExamples.length)
    expect(await count('glossary_terms', 'embedding IS NOT NULL')).toBe(glossary.length)

    const requestsAfterFirst = provider.requests
    const second = await indexKnowledge(seedInput(), client)
    expect(second.embedded).toBe(0)
    expect(provider.requests).toBe(requestsAfterFirst)
  })

  it('keeps the batches stored before a failed batch, and a re-run embeds only the rest', async () => {
    const provider = createMockEmbeddingProvider()
    let calls = 0
    const failingSecondBatch = createEmbeddingsClient({
      ...provider,
      embedBatch: (texts, task) => {
        calls += 1
        return calls === 2 ? Promise.reject(new Error('rate limited')) : provider.embedBatch(texts, task)
      },
    })
    const total = schema.tables.length + seedExamples.length + glossary.length
    expect(total).toBeGreaterThan(MAX_EMBEDDING_BATCH)

    await expect(indexKnowledge(seedInput(), failingSecondBatch)).rejects.toThrow('Embedding request failed')
    const stored =
      (await count('schema_tables', 'embedding IS NOT NULL')) +
      (await count('examples', 'embedding IS NOT NULL')) +
      (await count('glossary_terms', 'embedding IS NOT NULL'))
    expect(stored).toBe(MAX_EMBEDDING_BATCH)

    const retry = createMockEmbeddingProvider()
    const stats = await indexKnowledge(seedInput(), createEmbeddingsClient(retry))
    expect(stats.embedded).toBe(total - MAX_EMBEDDING_BATCH)
    expect(retry.requests).toBe(1)
    expect(await count('schema_tables', 'embedding IS NULL')).toBe(0)
  })

  it('records the embedding usage under source app', async () => {
    await indexKnowledge(seedInput(), createEmbeddingsClient(createMockEmbeddingProvider()))
    const rows = await getAppPool().query<{ source: string; embedding_requests: number; llm_tokens: number }>(
      'SELECT source, embedding_requests, llm_tokens FROM daily_usage',
    )
    expect(rows.rows).toEqual([{ source: 'app', embedding_requests: 2, llm_tokens: 0 }])
  })
})

describe('indexKnowledge changes', () => {
  const small = (): KnowledgeInput =>
    seedInput({
      schema: { tables: schema.tables.slice(0, 3) },
      examples: seedExamples.slice(0, 2),
      glossary: glossary.slice(0, 2),
    })

  it('re-embeds only the item whose text changed', async () => {
    const provider = createMockEmbeddingProvider()
    const client = createEmbeddingsClient(provider)
    await indexKnowledge(small(), client)
    const first = schema.tables[0]
    if (first === undefined) throw new Error('no tables')
    const key = `${first.schema}.${first.table}`
    const changed = await indexKnowledge({ ...small(), descriptions: { ...descriptions, [key]: 'A new description' } }, client)
    expect(changed.embedded).toBe(1)
    const row = await getAppPool().query<{ description: string; content_hash: string }>(
      'SELECT description, content_hash FROM schema_tables WHERE schema_name = $1 AND table_name = $2',
      [first.schema, first.table],
    )
    expect(row.rows[0]?.description).toBe('A new description')
  })

  it('re-embeds everything when the model changes', async () => {
    await indexKnowledge(small(), createEmbeddingsClient(createMockEmbeddingProvider()))
    const v2 = createMockEmbeddingProvider()
    const stats = await indexKnowledge(
      small(),
      createEmbeddingsClient({ ...v2, model: 'mock-embedding-v2', embedBatch: (t, task) => v2.embedBatch(t, task) }),
    )
    expect(stats.embedded).toBe(3 + 2 + 2)
  })

  it('stores the hash of model, size and text, and the vector of that text', async () => {
    await indexKnowledge(small(), createEmbeddingsClient(createMockEmbeddingProvider()))
    const term = glossary[0]
    if (term === undefined) throw new Error('no glossary')
    const row = await getAppPool().query<{ content_hash: string; embedding: string }>(
      'SELECT content_hash, embedding::text FROM glossary_terms WHERE term = $1',
      [term.term],
    )
    const text = `${term.term}: ${term.definition}`
    expect(row.rows[0]?.content_hash).toBe(contentHash('mock-embedding', 768, text))
    const stored = JSON.parse(row.rows[0]?.embedding ?? '[]') as number[]
    expect(stored[0]).toBeCloseTo(mockVector(text, 768)[0] ?? Number.NaN, 5)
  })

  it('never embeds pending examples and keeps feedback examples', async () => {
    await getAppPool().query(
      "INSERT INTO examples (question, sql, status, source) VALUES ('pending q', 'SELECT 1', 'pending', 'feedback')",
    )
    await indexKnowledge(small(), createEmbeddingsClient(createMockEmbeddingProvider()))
    expect(await count('examples', "source = 'feedback' AND embedding IS NULL")).toBe(1)
  })

  it('removes seed examples and tables that left the files, but never glossary terms', async () => {
    const client = createEmbeddingsClient(createMockEmbeddingProvider())
    await indexKnowledge(small(), client)
    const stats = await indexKnowledge(
      { ...small(), schema: { tables: schema.tables.slice(0, 2) }, examples: seedExamples.slice(0, 1), glossary: [] },
      client,
    )
    expect(stats.deletedTables).toBe(1)
    expect(stats.deletedSeedExamples).toBe(1)
    expect(await count('schema_tables')).toBe(2)
    expect(await count('examples')).toBe(1)
    expect(await count('glossary_terms')).toBe(2)
  })

  it('keeps an admin rejection when a seed example SQL changes', async () => {
    const client = createEmbeddingsClient(createMockEmbeddingProvider())
    await indexKnowledge(small(), client)
    const example = seedExamples[0]
    if (example === undefined) throw new Error('no examples')
    await getAppPool().query("UPDATE examples SET status = 'rejected' WHERE question = $1", [example.question])
    await indexKnowledge(
      { ...small(), examples: [{ ...example, sql: 'SELECT count(*) AS n FROM sales.salesorderheader' }, ...seedExamples.slice(1, 2)] },
      client,
    )
    const row = await getAppPool().query<{ status: string; sql: string }>('SELECT status, sql FROM examples WHERE question = $1', [
      example.question,
    ])
    expect(row.rows[0]).toEqual({ status: 'rejected', sql: 'SELECT count(*) AS n FROM sales.salesorderheader' })
  })

  it('refuses tables without descriptions before writing anything', async () => {
    const provider = createMockEmbeddingProvider()
    await expect(indexKnowledge({ ...small(), descriptions: {} }, createEmbeddingsClient(provider))).rejects.toThrow(
      /3 table\(s\) have no description/,
    )
    expect(await count('schema_tables')).toBe(0)
    expect(provider.requests).toBe(0)
  })

  it('refuses seed examples that fail the validator', async () => {
    const provider = createMockEmbeddingProvider()
    await expect(
      indexKnowledge(
        { ...small(), examples: [{ question: 'Read passwords', sql: 'SELECT passwordhash FROM person.password' }] },
        createEmbeddingsClient(provider),
      ),
    ).rejects.toThrow(/seed example 1 fails validation \(TABLE_DENIED\)/)
    expect(await count('examples')).toBe(0)
  })
})
