import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { getCheckpointer } from '../../src/agent/checkpointer.js'
import { classifyGroqRateLimit, createLlmClient } from '../../src/agent/llm.js'
import { createMockChatProvider, type MockReply } from '../../src/agent/mock-llm.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { examplesFileSchema, glossaryFileSchema, readSeedFile, schemaFileSchema, seedPath } from '../../src/kb/seed-files.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { indexKnowledge } from '../../src/retrieval/indexer.js'
import { createMockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { errorOf, parseSse, type SseEvent } from '../helpers/http.js'
import { captureLogger } from '../helpers/log-capture.js'

// Public endpoints (IMPLEMENTATION.md 14.1, 14.3) against querycraft_test and
// adventureworks, with the mock LLM and mock embeddings (M5 acceptance).

const ADMIN_TOKEN = 'test-admin-token-not-a-secret-0123456789'
vi.stubEnv('ADMIN_TOKEN', ADMIN_TOKEN)
vi.stubEnv('LLM_MODEL', 'main-model')
vi.stubEnv('LLM_ANSWER_MODEL', 'answer-model')
vi.stubEnv('MAX_SQL_ATTEMPTS', '3')
vi.stubEnv('MAX_CLARIFICATIONS', '1')
vi.stubEnv('QUESTION_MAX_LENGTH', '500')
vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '1000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '100000')
vi.stubEnv('QUERY_ROW_LIMIT', '20')

// Plan costs on AdventureWorks: ~8, ~3 300 (above the soft limit) and ~2.2e8 (above the hard limit).
const CHEAP = 'SELECT name FROM sales.store WHERE businessentityid = 292'
const MEDIUM = 'SELECT productid, sum(orderqty) AS units FROM sales.salesorderdetail GROUP BY productid'
const HUGE = 'SELECT count(*) FROM sales.salesorderdetail a, sales.salesorderdetail b'
const EMAIL = 'SELECT emailaddress FROM person.emailaddress WHERE businessentityid = 1'
const ANSWER = 'The store is Next-Door Bike Shop.'
const LEAKY_ERROR = 'provider exploded: password=hunter2 at /srv/app/secret.js:10'

function sqlReply(sql: string): string {
  return JSON.stringify({
    result: { action: 'sql', sql, tablesUsed: ['sales.store'], assumptions: [], explanation: 'Looks up the store.' },
  })
}
const clarifyReply = JSON.stringify({ result: { action: 'clarify', question: 'Which year?', options: ['2023', '2024'] } })
const cannotReply = JSON.stringify({ result: { action: 'cannot_answer', reason: 'Website visits are not in the data.' } })

let queue: MockReply[] = []
const provider = createMockChatProvider((_messages, _model, format) => {
  if (format === undefined) return ANSWER
  return queue.shift() ?? new Error('unexpected generate call')
}, classifyGroqRateLimit)

/** Every response body of this file, scanned at the end for leaks. */
const bodies: string[] = []

async function testApp(rateLimitPerMinute = 1000): Promise<ReturnType<typeof createApp>> {
  const { logger } = captureLogger()
  return createApp({
    logger,
    clientOrigin: 'http://localhost:5173',
    trustProxy: 0,
    questionDeps: {
      llm: createLlmClient(provider, { sleep: () => Promise.resolve() }),
      embeddings: createEmbeddingsClient(createMockEmbeddingProvider()),
      checkpointer: await getCheckpointer(),
    },
    rateLimitPerMinute,
  })
}

let app: ReturnType<typeof createApp>

function record<T extends { text: string }>(res: T): T {
  bodies.push(res.text)
  return res
}

/** Reads the SSE stream of a question until `done`. */
async function events(id: string): Promise<SseEvent[]> {
  const res = await request(app).get(`/api/questions/${id}/events`).buffer(true)
  expect(res.status).toBe(200)
  expect(res.headers['content-type']).toContain('text/event-stream')
  bodies.push(res.text)
  return parseSse(res.text)
}

function names(list: SseEvent[]): string[] {
  return list.filter((e) => e.event !== 'step').map((e) => e.event)
}

function dataOf(list: SseEvent[], event: string): Record<string, unknown> {
  const found = list.find((e) => e.event === event)
  if (found === undefined) throw new Error(`no ${event} event`)
  return found.data as Record<string, unknown>
}

async function ask(question: string, replies: MockReply[], conversationId?: string): Promise<{ id: string; conversationId: string }> {
  queue = [...replies]
  const res = record(await request(app).post('/api/questions').send(conversationId === undefined ? { question } : { question, conversationId }))
  expect(res.status).toBe(202)
  const body = res.body as { questionId: string; conversationId: string }
  return { id: body.questionId, conversationId: body.conversationId }
}

/** An answered question inserted directly (for rerun rules). */
async function answeredQuestion(sql: string): Promise<string> {
  const result = await getAppPool().query<{ id: string }>(
    `WITH c AS (INSERT INTO conversations DEFAULT VALUES RETURNING id)
     INSERT INTO questions (conversation_id, question, status, final_sql, answer) SELECT id, 'q', 'answered', $1, 'a' FROM c RETURNING id`,
    [sql],
  )
  const id = result.rows[0]?.id
  if (id === undefined) throw new Error('question not created')
  return id
}

async function auditRules(id: string): Promise<string[]> {
  const result = await getAppPool().query<{ rule: string }>(
    'SELECT rule FROM audit_events WHERE question_id = $1 ORDER BY created_at',
    [id],
  )
  return result.rows.map((r) => r.rule)
}

beforeAll(async () => {
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
  app = await testApp()
})

beforeEach(async () => {
  await getAppPool().query('TRUNCATE feedback, audit_events, questions, conversations, daily_usage')
  queue = []
})

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

describe('POST /api/questions and the SSE stream', () => {
  it('answers: 202, steps in node order, answer with masked rows, done; the record has no rows', async () => {
    const { id, conversationId } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/)
    const stream = await events(id)
    expect(names(stream)).toEqual(['answer', 'done'])
    const steps = stream.filter((e) => e.event === 'step').map((e) => e.data as { node: string; status: string })
    expect(steps.slice(0, 2)).toEqual([
      { node: 'input_guard', status: 'started' },
      { node: 'input_guard', status: 'completed' },
    ])
    expect(steps.filter((s) => s.status === 'completed').map((s) => s.node)).toEqual([
      'input_guard', 'retrieve_context', 'generate', 'validate_sql', 'cost_check', 'execute', 'mask_output', 'answer',
    ])
    // Every step starts before it completes.
    for (const [i, s] of steps.entries()) {
      if (s.status === 'completed') expect(steps.slice(0, i)).toContainEqual({ node: s.node, status: 'started' })
    }
    const answer = dataOf(stream, 'answer')
    expect(answer).toMatchObject({ answer: ANSWER, sql: CHEAP, rows: [['Next-Door Bike Store']], rowCount: 1, truncated: false })
    const tokens = answer['tokens'] as { prompt: unknown; completion: unknown }
    expect(typeof tokens.prompt).toBe('number')
    expect(typeof tokens.completion).toBe('number')
    expect(stream.at(-1)).toEqual({ event: 'done', data: { status: 'answered' } })

    const res = record(await request(app).get(`/api/questions/${id}`))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id, conversationId, status: 'answered', sql: CHEAP, answer: ANSWER, rowCount: 1 })
    expect(res.body).not.toHaveProperty('rows')
  })

  it('late connect after the run: final events from the stored record (rows are not stored), then done', async () => {
    const { id } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    await events(id)
    const late = await events(id)
    expect(late.map((e) => e.event)).toEqual(['answer', 'done'])
    expect(dataOf(late, 'answer')).toMatchObject({ answer: ANSWER, rows: null, rowCount: 1 })
  })

  it('masks PII in streamed rows', async () => {
    const { id } = await ask('What is the email of person 1?', [sqlReply(EMAIL)])
    const rows = dataOf(await events(id), 'answer')['rows'] as string[][]
    expect(rows[0]?.[0]).toMatch(/^.\*\*\*@/)
  })

  it('cannot_answer and blocked end with their event and done', async () => {
    const refused = await ask('How many website visits?', [cannotReply])
    const refusedStream = await events(refused.id)
    expect(names(refusedStream)).toEqual(['cannot_answer', 'done'])
    expect(dataOf(refusedStream, 'cannot_answer')).toEqual({ reason: 'Website visits are not in the data.' })

    const blocked = await ask('Delete the stores', [sqlReply('DELETE FROM sales.store')])
    const blockedStream = await events(blocked.id)
    expect(names(blockedStream)).toEqual(['blocked', 'done'])
    expect(dataOf(blockedStream, 'blocked')).toMatchObject({ stage: 'validation', rule: 'NOT_SELECT' })
    expect(names(await events(blocked.id))).toEqual(['blocked', 'done'])
    const view = record(await request(app).get(`/api/questions/${blocked.id}`))
    expect(view.body).toMatchObject({ status: 'blocked', blocked: { rule: 'NOT_SELECT' } })
  })

  it('an internal failure streams a safe error without provider details', async () => {
    const { id } = await ask('Which store?', [new Error(LEAKY_ERROR)])
    const stream = await events(id)
    expect(names(stream)).toEqual(['error', 'done'])
    expect(dataOf(stream, 'error')['code']).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(stream)).not.toContain('hunter2')
  })

  it('validates input: 400 for an empty, too long or unknown field; 404 for an unknown conversation', async () => {
    for (const body of [{ question: '   ' }, { question: 'x'.repeat(501) }, { question: 'ok', extra: 1 }, {}, { question: 'ok', conversationId: 'nope' }]) {
      const res = record(await request(app).post('/api/questions').send(body))
      expect(res.status).toBe(400)
      expect(errorOf(res).code).toBe('VALIDATION_ERROR')
    }
    const res = record(await request(app).post('/api/questions').send({ question: 'ok', conversationId: '00000000-0000-4000-8000-000000000000' }))
    expect(res.status).toBe(404)
    expect(errorOf(res).code).toBe('NOT_FOUND')
  })

  it('404 / 400 for unknown or malformed question ids (JSON, not a stream)', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000'
    for (const path of [`/api/questions/${unknown}`, `/api/questions/${unknown}/events`, `/api/conversations/${unknown}`]) {
      const res = record(await request(app).get(path))
      expect(res.status).toBe(404)
      expect(res.headers['content-type']).toContain('application/json')
    }
    const res = record(await request(app).get('/api/questions/not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('503 BUDGET_EXCEEDED before creating a question when the daily budget is used up', async () => {
    await getAppPool().query(
      "INSERT INTO daily_usage (day, source, llm_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date, 'app', 1000000)",
    )
    const res = record(await request(app).post('/api/questions').send({ question: 'Which store?' }))
    expect(res.status).toBe(503)
    expect(errorOf(res).code).toBe('BUDGET_EXCEEDED')
    const count = await getAppPool().query<{ n: string }>('SELECT count(*) AS n FROM questions')
    expect(count.rows[0]?.n).toBe('0')
  })
})

describe('clarification and approval (human in the loop)', () => {
  it('clarification: paused stream ends with done; 409 for the wrong resume; resume answers', async () => {
    const { id } = await ask('Sales by year?', [clarifyReply, sqlReply(CHEAP)])
    const paused = await events(id)
    expect(names(paused)).toEqual(['clarification_required', 'done'])
    expect(dataOf(paused, 'clarification_required')).toEqual({ question: 'Which year?', options: ['2023', '2024'] })
    expect(paused.at(-1)?.data).toEqual({ status: 'awaiting_clarification' })
    // Late connect while paused: the request comes from the checkpoint.
    expect(names(await events(id))).toEqual(['clarification_required', 'done'])
    const view = record(await request(app).get(`/api/questions/${id}`))
    expect(view.body).toMatchObject({ status: 'awaiting_clarification', clarification: { question: 'Which year?' } })

    const wrong = record(await request(app).post(`/api/questions/${id}/approval`).send({ approved: true }))
    expect(wrong.status).toBe(409)
    expect(errorOf(wrong).code).toBe('INVALID_STATE')
    const empty = record(await request(app).post(`/api/questions/${id}/clarification`).send({ answer: ' ' }))
    expect(empty.status).toBe(400)

    const resumed = record(await request(app).post(`/api/questions/${id}/clarification`).send({ answer: '2024' }))
    expect(resumed.status).toBe(202)
    const after = await events(id)
    expect(names(after)).toEqual(['answer', 'done'])
    const again = record(await request(app).post(`/api/questions/${id}/clarification`).send({ answer: '2024' }))
    expect(again.status).toBe(409)
  })

  it('approval approved: executes, and rerun above the soft limit is allowed and recorded (COST_APPROVED)', async () => {
    const { id } = await ask('Units per product?', [sqlReply(MEDIUM)])
    const paused = await events(id)
    expect(names(paused)).toEqual(['approval_required', 'done'])
    const approval = dataOf(paused, 'approval_required')
    expect(approval['softLimit']).toBe(1000)
    expect(approval['estimatedCost']).toBeGreaterThan(1000)
    const res = record(await request(app).post(`/api/questions/${id}/approval`).send({ approved: true }))
    expect(res.status).toBe(202)
    expect(names(await events(id))).toEqual(['answer', 'done'])

    const before = (await auditRules(id)).filter((r) => r === 'COST_APPROVED').length
    const rerun = record(await request(app).post(`/api/questions/${id}/rerun`))
    expect(rerun.status).toBe(200)
    expect(rerun.body).toMatchObject({ status: 'executed', rowCount: 20, truncated: true })
    expect((rerun.body as { rows: unknown[] }).rows).toHaveLength(20)
    expect((await auditRules(id)).filter((r) => r === 'COST_APPROVED').length).toBe(before + 1)
  })

  it('approval denied: cancelled, nothing executed', async () => {
    const { id } = await ask('Units per product?', [sqlReply(MEDIUM)])
    await events(id)
    record(await request(app).post(`/api/questions/${id}/approval`).send({ approved: false }))
    const stream = await events(id)
    expect(stream.at(-1)).toEqual({ event: 'done', data: { status: 'cancelled' } })
    expect(await auditRules(id)).not.toContain('EXECUTED')
    expect(record(await request(app).post(`/api/questions/${id}/approval`).send({ approved: 'yes' })).status).toBe(400)
  })
})

describe('POST /api/questions/:id/rerun', () => {
  it('re-executes a cheap answered question through the pipeline', async () => {
    const id = await answeredQuestion(CHEAP)
    const res = record(await request(app).post(`/api/questions/${id}/rerun`))
    expect(res.body).toMatchObject({ status: 'executed', rows: [['Next-Door Bike Store']], rowCount: 1, truncated: false })
    expect((res.body as { columns: { name: string }[] }).columns.map((c) => c.name)).toEqual(['name'])
    expect(await auditRules(id)).toEqual(['POLICY_OK', 'COST_OK', 'EXECUTED'])
  })

  it('blocks above the soft limit without a recorded approval, and above the hard limit even with one', async () => {
    const medium = await answeredQuestion(MEDIUM)
    expect(record(await request(app).post(`/api/questions/${medium}/rerun`)).body).toMatchObject({ status: 'blocked', rule: 'COST_SOFT_LIMIT' })
    const huge = await answeredQuestion(HUGE)
    await getAppPool().query(
      "INSERT INTO audit_events (question_id, source, stage, decision, rule, message) VALUES ($1, 'app', 'cost', 'allowed', 'COST_APPROVED', 'approved')",
      [huge],
    )
    expect(record(await request(app).post(`/api/questions/${huge}/rerun`)).body).toMatchObject({ status: 'blocked', rule: 'COST_HARD_LIMIT' })
  })

  it('409 unless answered; 404 for an unknown question', async () => {
    const { id } = await ask('Delete the stores', [sqlReply('DELETE FROM sales.store')])
    await events(id)
    expect(record(await request(app).post(`/api/questions/${id}/rerun`)).status).toBe(409)
    expect(record(await request(app).post('/api/questions/00000000-0000-4000-8000-000000000000/rerun')).status).toBe(404)
  })
})

describe('POST /api/questions/:id/feedback', () => {
  it('up on an answered question creates one pending example; a second rating is 409', async () => {
    const { id } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    await events(id)
    const res = record(await request(app).post(`/api/questions/${id}/feedback`).send({ rating: 'up', comment: 'great' }))
    expect(res.status).toBe(201)
    const exampleId = (res.body as { exampleId: string }).exampleId
    const example = await getAppPool().query<{ status: string; source: string; sql: string; embedding: unknown }>(
      'SELECT status, source, sql, embedding FROM examples WHERE id = $1',
      [exampleId],
    )
    expect(example.rows[0]).toEqual({ status: 'pending', source: 'feedback', sql: CHEAP, embedding: null })
    const again = record(await request(app).post(`/api/questions/${id}/feedback`).send({ rating: 'down' }))
    expect(again.status).toBe(409)
  })

  it('down creates no example; feedback on a paused question is 409; bad input 400; unknown 404', async () => {
    const refused = await ask('Website visits?', [cannotReply])
    await events(refused.id)
    const down = record(await request(app).post(`/api/questions/${refused.id}/feedback`).send({ rating: 'down' }))
    expect(down.status).toBe(201)
    expect(down.body).toMatchObject({ exampleId: null })

    const paused = await ask('Sales by year?', [clarifyReply])
    await events(paused.id)
    expect(record(await request(app).post(`/api/questions/${paused.id}/feedback`).send({ rating: 'up' })).status).toBe(409)
    expect(record(await request(app).post(`/api/questions/${paused.id}/feedback`).send({ rating: 'meh' })).status).toBe(400)
    expect(
      record(await request(app).post(`/api/questions/${paused.id}/feedback`).send({ rating: 'up', comment: 'x'.repeat(1001) })).status,
    ).toBe(400)
    expect(record(await request(app).post('/api/questions/00000000-0000-4000-8000-000000000000/feedback').send({ rating: 'up' })).status).toBe(404)
  })
})

describe('GET /api/conversations/:id', () => {
  it('returns the conversation with its questions in order', async () => {
    const first = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    await events(first.id)
    const second = await ask('And its name?', [sqlReply(CHEAP)], first.conversationId)
    await events(second.id)
    const res = record(await request(app).get(`/api/conversations/${first.conversationId}`))
    expect(res.status).toBe(200)
    const body = res.body as { id: string; questions: { id: string; status: string }[] }
    expect(body.id).toBe(first.conversationId)
    expect(body.questions.map((q) => q.id)).toEqual([first.id, second.id])
    expect(body.questions.every((q) => q.status === 'answered')).toBe(true)
  })
})

describe('rate limit', () => {
  it('429 RATE_LIMITED in the contract shape after RATE_LIMIT_PER_MINUTE question and resume requests', async () => {
    const limited = await testApp(2)
    const unknown = '00000000-0000-4000-8000-000000000000'
    expect((await request(limited).post(`/api/questions/${unknown}/clarification`).send({ answer: 'a' })).status).toBe(404)
    expect((await request(limited).post(`/api/questions/${unknown}/approval`).send({ approved: true })).status).toBe(404)
    const res = record(await request(limited).post('/api/questions').send({ question: 'Which store?' }))
    expect(res.status).toBe(429)
    expect(errorOf(res)).toMatchObject({ code: 'RATE_LIMITED', details: {} })
    expect(Object.keys(res.body as object)).toEqual(['error'])
    expect(res.headers['retry-after']).toBeDefined()
    // Reads are not limited.
    expect((await request(limited).get(`/api/questions/${unknown}`)).status).toBe(404)
  })
})

describe('responses never leak', () => {
  it('no admin token, connection string, stack trace or denied column value in any response of this file', () => {
    const all = bodies.join('\n')
    expect(bodies.length).toBeGreaterThan(20)
    expect(all).not.toContain(ADMIN_TOKEN)
    expect(all).not.toMatch(/postgres(ql)?:\/\//)
    expect(all).not.toMatch(/\n\s+at \S+ \(/)
    expect(all).not.toContain('hunter2')
    expect(all).not.toMatch(/"(cardnumber|nationalidnumber|loginid|passwordhash)"/)
  })
})
