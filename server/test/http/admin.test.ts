import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { getCheckpointer } from '../../src/agent/checkpointer.js'
import { createLlmClient } from '../../src/agent/llm.js'
import { createMockChatProvider } from '../../src/agent/mock-llm.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { examplesFileSchema, glossaryFileSchema, readSeedFile, schemaFileSchema, seedPath } from '../../src/kb/seed-files.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { indexKnowledge } from '../../src/retrieval/indexer.js'
import { createMockEmbeddingProvider, type MockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { errorOf } from '../helpers/http.js'
import { captureLogger } from '../helpers/log-capture.js'

// Admin endpoints (IMPLEMENTATION.md 14.2) against querycraft_test with mock
// embeddings. Knowledge-base edits here never touch querycraft_app.

const ADMIN_TOKEN = 'test-admin-token-not-a-secret-0123456789'
vi.stubEnv('ADMIN_TOKEN', ADMIN_TOKEN)
vi.stubEnv('DAILY_TOKEN_BUDGET', '250000')
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '1000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '100000')
vi.stubEnv('QUERY_ROW_LIMIT', '20')

const CHEAP = 'SELECT name FROM sales.store WHERE businessentityid = 292'
const MEDIUM = 'SELECT productid, sum(orderqty) AS units FROM sales.salesorderdetail GROUP BY productid'

let app: ReturnType<typeof createApp>
let embeddingProvider: MockEmbeddingProvider
const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` }
const bodies: string[] = []

function admin(method: 'get' | 'post' | 'patch' | 'delete', path: string): request.Test {
  return request(app)[method](`/api/admin${path}`).set(auth)
}

async function sent(test: request.Test): Promise<request.Response> {
  const res = await test
  bodies.push(res.text)
  return res
}

beforeAll(async () => {
  embeddingProvider = createMockEmbeddingProvider()
  const { logger } = captureLogger()
  app = createApp({
    logger,
    clientOrigin: 'http://localhost:5173',
    trustProxy: 0,
    questionDeps: {
      llm: createLlmClient(createMockChatProvider(() => new Error('no LLM in admin tests'))),
      embeddings: createEmbeddingsClient(embeddingProvider),
      checkpointer: await getCheckpointer(),
    },
    rateLimitPerMinute: 1000,
  })
})

beforeEach(async () => {
  await getAppPool().query('TRUNCATE feedback, audit_events, questions, conversations, daily_usage')
  await getAppPool().query('TRUNCATE schema_tables, examples, glossary_terms, column_values')
  const schema = await readSeedFile(seedPath.schema, schemaFileSchema)
  await indexKnowledge(
    {
      schema,
      descriptions: Object.fromEntries(schema.tables.map((t) => [`${t.schema}.${t.table}`, `The ${t.table} table`])),
      examples: await readSeedFile(seedPath.examples, examplesFileSchema),
      glossary: await readSeedFile(seedPath.glossary, glossaryFileSchema),
    },
    createEmbeddingsClient(createMockEmbeddingProvider()),
  )
})

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

describe('admin auth', () => {
  it('401 UNAUTHORIZED without, with a wrong or with a non-Bearer token, on every admin route', async () => {
    const routes: ['get' | 'post' | 'patch' | 'delete', string][] = [
      ['get', '/examples'], ['post', '/examples'], ['patch', '/examples/00000000-0000-4000-8000-000000000000'],
      ['get', '/tables'], ['patch', '/tables/00000000-0000-4000-8000-000000000000'],
      ['get', '/glossary'], ['post', '/glossary'], ['patch', '/glossary/00000000-0000-4000-8000-000000000000'],
      ['delete', '/glossary/00000000-0000-4000-8000-000000000000'], ['post', '/reindex'], ['get', '/audit'], ['get', '/usage'],
    ]
    for (const [method, path] of routes) {
      for (const header of [undefined, `Bearer ${ADMIN_TOKEN}x`, `Basic ${ADMIN_TOKEN}`, 'Bearer ']) {
        const req = request(app)[method](`/api/admin${path}`)
        const res = await sent(header === undefined ? req : req.set('Authorization', header))
        expect(res.status).toBe(401)
        expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Admin token missing or invalid', details: {} } })
      }
    }
    expect((await sent(admin('get', '/usage'))).status).toBe(200)
  })
})

describe('examples', () => {
  it('lists, filters by status and rejects an unknown status', async () => {
    const all = await sent(admin('get', '/examples'))
    expect(all.status).toBe(200)
    const list = (all.body as { examples: { status: string; source: string; indexed: boolean }[] }).examples
    expect(list.length).toBeGreaterThan(20)
    expect(list.every((e) => e.status === 'verified' && e.source === 'seed' && e.indexed)).toBe(true)
    expect(((await sent(admin('get', '/examples?status=pending'))).body as { examples: unknown[] }).examples).toEqual([])
    expect((await sent(admin('get', '/examples?status=nope'))).status).toBe(400)
  })

  it('creates a verified example only when its SQL passes the pipeline and executes', async () => {
    const created = await sent(admin('post', '/examples').send({ question: 'Name of store 292?', sql: CHEAP }))
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ status: 'verified', source: 'admin', indexed: false })
    expect(typeof (created.body as { verifiedAt: unknown }).verifiedAt).toBe('string')

    for (const sql of ['DELETE FROM sales.store', 'SELECT cardnumber FROM sales.creditcard', MEDIUM, 'SELECT nope FROM sales.store']) {
      const res = await sent(admin('post', '/examples').send({ question: 'q', sql }))
      expect(res.status).toBe(400)
      expect(errorOf(res).code).toBe('VALIDATION_ERROR')
      expect(errorOf(res).details).toHaveProperty('rule')
    }
    expect((await sent(admin('post', '/examples').send({ question: '', sql: CHEAP }))).status).toBe(400)
  })

  it('verifies a pending feedback example only if its SQL executes; reject clears verifiedAt; 404 unknown', async () => {
    const pending = await getAppPool().query<{ id: string }>(
      "INSERT INTO examples (question, sql, status, source) VALUES ('q1', $1, 'pending', 'feedback'), ('q2', 'DELETE FROM sales.store', 'pending', 'feedback') RETURNING id",
      [CHEAP],
    )
    const [good, bad] = pending.rows.map((r) => r.id)
    const verified = await sent(admin('patch', `/examples/${good}`).send({ status: 'verified' }))
    expect(verified.body).toMatchObject({ status: 'verified' })
    expect(typeof (verified.body as { verifiedAt: unknown }).verifiedAt).toBe('string')
    expect((await sent(admin('patch', `/examples/${bad}`).send({ status: 'verified' }))).status).toBe(400)

    const rejected = await sent(admin('patch', `/examples/${good}`).send({ status: 'rejected' }))
    expect(rejected.body).toMatchObject({ status: 'rejected', verifiedAt: null })
    // Editing the SQL of a verified example re-checks it.
    const seed = ((await sent(admin('get', '/examples'))).body as { examples: { id: string; status: string }[] }).examples.find(
      (e) => e.status === 'verified',
    )
    expect((await sent(admin('patch', `/examples/${seed?.id}`).send({ sql: 'DROP TABLE sales.store' }))).status).toBe(400)
    expect((await sent(admin('patch', `/examples/${seed?.id}`).send({}))).status).toBe(400)
    expect((await sent(admin('patch', '/examples/00000000-0000-4000-8000-000000000000').send({ status: 'rejected' }))).status).toBe(404)
  })
})

describe('tables, glossary and re-index', () => {
  it('edits a table description; re-index embeds only the changed and new entries, then nothing', async () => {
    const tables = (await sent(admin('get', '/tables'))).body as { tables: { id: string; schema: string; table: string; indexed: boolean }[] }
    expect(tables.tables.length).toBe(67)
    const store = tables.tables.find((t) => t.schema === 'sales' && t.table === 'store')
    const edited = await sent(admin('patch', `/tables/${store?.id}`).send({ description: 'Retail stores that buy bikes.' }))
    expect(edited.body).toMatchObject({ description: 'Retail stores that buy bikes.' })
    await sent(admin('post', '/examples').send({ question: 'Name of store 292?', sql: CHEAP }))
    await sent(admin('post', '/glossary').send({ term: 'flagship store', definition: 'Store 292.' }))

    const before = embeddingProvider.texts
    const first = await sent(admin('post', '/reindex'))
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ tables: 1, examples: 1, glossary: 1, embedded: 3 })
    expect(embeddingProvider.texts - before).toBe(3)
    expect((await sent(admin('post', '/reindex'))).body).toEqual({ tables: 0, examples: 0, glossary: 0, embedded: 0 })
    const example = ((await sent(admin('get', '/examples'))).body as { examples: { source: string; indexed: boolean }[] }).examples.find(
      (e) => e.source === 'admin',
    )
    expect(example?.indexed).toBe(true)

    expect((await sent(admin('patch', `/tables/${store?.id}`).send({ description: ' ' }))).status).toBe(400)
    expect((await sent(admin('patch', '/tables/00000000-0000-4000-8000-000000000000').send({ description: 'x' }))).status).toBe(404)
  })

  it('glossary: create, duplicate 409, update, delete 204, then 404', async () => {
    const created = await sent(admin('post', '/glossary').send({ term: 'big order', definition: 'Total due above 10,000.', sqlHint: 'totaldue > 10000' }))
    expect(created.status).toBe(201)
    const id = (created.body as { id: string }).id
    const duplicate = await sent(admin('post', '/glossary').send({ term: 'big order', definition: 'x' }))
    expect(duplicate.status).toBe(409)
    expect(errorOf(duplicate).code).toBe('INVALID_STATE')
    expect((await sent(admin('patch', `/glossary/${id}`).send({ sqlHint: null }))).body).toMatchObject({ term: 'big order', sqlHint: null })
    const terms = ((await sent(admin('get', '/glossary'))).body as { terms: { term: string }[] }).terms
    expect(terms.map((t) => t.term)).toContain('big order')
    expect((await sent(admin('delete', `/glossary/${id}`))).status).toBe(204)
    expect((await sent(admin('delete', `/glossary/${id}`))).status).toBe(404)
    expect((await sent(admin('post', '/glossary').send({ term: 'x' }))).status).toBe(400)
  })
})

describe('audit and usage', () => {
  it('pages the audit log newest first with a cursor, filters by decision and hides raw database errors', async () => {
    const pool = getAppPool()
    for (let i = 0; i < 5; i += 1) {
      await pool.query(
        "INSERT INTO audit_events (source, stage, decision, rule, message, detail) VALUES ('app', 'execution', $1, $2, 'm', $3)",
        [i === 4 ? 'blocked' : 'allowed', `R${i}`, JSON.stringify({ sqlState: '42703', dbMessage: 'column "secret_col" does not exist' })],
      )
    }
    const first = await sent(admin('get', '/audit?limit=2'))
    const page1 = first.body as { events: { id: string; rule: string; detail: Record<string, unknown> }[]; nextBefore: string }
    expect(page1.events.map((e) => e.rule)).toEqual(['R4', 'R3'])
    expect(page1.nextBefore).toBe(page1.events[1]?.id)
    expect(page1.events[0]?.detail).toEqual({ sqlState: '42703' })
    const page2 = (await sent(admin('get', `/audit?limit=2&before=${page1.nextBefore}`))).body as { events: { rule: string }[]; nextBefore: string }
    expect(page2.events.map((e) => e.rule)).toEqual(['R2', 'R1'])
    const page3 = (await sent(admin('get', `/audit?limit=2&before=${page2.nextBefore}`))).body as { events: { rule: string }[]; nextBefore: string | null }
    expect(page3).toMatchObject({ events: [{ rule: 'R0' }], nextBefore: null })
    expect(((await sent(admin('get', '/audit?decision=blocked'))).body as { events: { rule: string }[] }).events.map((e) => e.rule)).toEqual(['R4'])

    expect((await sent(admin('get', '/audit?limit=0'))).status).toBe(400)
    expect((await sent(admin('get', '/audit?limit=201'))).status).toBe(400)
    expect((await sent(admin('get', '/audit?decision=maybe'))).status).toBe(400)
    expect((await sent(admin('get', '/audit?before=00000000-0000-4000-8000-000000000000'))).status).toBe(404)
  })

  it('usage: today (UTC) for app + MCP, the budget and questions by status', async () => {
    const pool = getAppPool()
    // beforeEach indexing recorded embedding usage; start from known rows.
    await pool.query('TRUNCATE daily_usage')
    await pool.query(
      `INSERT INTO daily_usage (day, source, llm_tokens, embedding_requests) VALUES
         ((now() AT TIME ZONE 'UTC')::date, 'app', 1200, 3),
         ((now() AT TIME ZONE 'UTC')::date, 'mcp', 300, 1),
         ((now() AT TIME ZONE 'UTC')::date, 'eval', 99999, 50),
         ((now() AT TIME ZONE 'UTC')::date - 1, 'app', 5000, 9)`,
    )
    await pool.query(
      `WITH c AS (INSERT INTO conversations DEFAULT VALUES RETURNING id)
       INSERT INTO questions (conversation_id, question, status) SELECT id, 'q', s::question_status FROM c, unnest(ARRAY['answered', 'answered', 'blocked']) s`,
    )
    const res = await sent(admin('get', '/usage'))
    expect(res.body).toEqual({
      date: new Date().toISOString().slice(0, 10),
      llmTokens: 1500,
      tokenBudget: 250000,
      embeddingRequests: 4,
      questionsByStatus: { answered: 2, blocked: 1 },
    })
  })
})

describe('admin responses never leak', () => {
  it('no admin token, connection string, stack trace or raw database error text', () => {
    const all = bodies.join('\n')
    expect(all).not.toContain(ADMIN_TOKEN)
    expect(all).not.toMatch(/postgres(ql)?:\/\//)
    expect(all).not.toMatch(/\n\s+at \S+ \(/)
    expect(all).not.toContain('secret_col')
  })
})
