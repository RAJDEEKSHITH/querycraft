import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCheckpointer } from '../../src/agent/checkpointer.js'
import { classifyGroqRateLimit, createLlmClient, type JsonResponseFormat } from '../../src/agent/llm.js'
import { createMockChatProvider, type MockChatProvider, type MockReply } from '../../src/agent/mock-llm.js'
import { NO_MORE_CLARIFICATIONS, ZERO_ROW_REVIEW } from '../../src/agent/prompts/generate.js'
import type { AgentFlags } from '../../src/agent/state.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { AppError } from '../../src/lib/errors.js'
import { examplesFileSchema, glossaryFileSchema, readSeedFile, schemaFileSchema, seedPath } from '../../src/kb/seed-files.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { indexKnowledge } from '../../src/retrieval/indexer.js'
import { createMockEmbeddingProvider, type MockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import {
  createQuestion,
  recoverStaleRuns,
  resumeApproval,
  resumeClarification,
  runQuestion,
  type QuestionDeps,
  type RunOptions,
  type RunOutcome,
} from '../../src/services/question.service.js'

// Every agent path of IMPLEMENTATION.md 12.1 (M3 acceptance) with the mock LLM and
// mock embeddings against the real querycraft_test and adventureworks databases.

vi.stubEnv('LLM_MODEL', 'main-model')
vi.stubEnv('LLM_ANSWER_MODEL', 'answer-model')
vi.stubEnv('MAX_SQL_ATTEMPTS', '3')
vi.stubEnv('MAX_CLARIFICATIONS', '1')
vi.stubEnv('QUESTION_MAX_LENGTH', '500')
vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '1000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '100000')
vi.stubEnv('QUERY_ROW_LIMIT', '20')
vi.stubEnv('PROVIDER_MAX_RETRIES', '2')
vi.stubEnv('PROVIDER_MAX_WAIT_MS', '5000')

// Plan costs on AdventureWorks: ~8, ~3 300 (above the soft limit) and ~2.2e8 (above the hard limit).
const CHEAP = 'SELECT name FROM sales.store WHERE businessentityid = 292'
const MEDIUM = 'SELECT productid, sum(orderqty) AS units FROM sales.salesorderdetail GROUP BY productid'
const HUGE = 'SELECT count(*) FROM sales.salesorderdetail a, sales.salesorderdetail b'
const SQL_ERROR = 'SELECT 1 / (listprice - listprice) AS x FROM production.product'
const ZERO_ROWS = "SELECT name FROM sales.store WHERE name = 'No such store'"
const ANSWER = 'The store is Next-Door Bike Shop.'

function sqlReply(sql: string, assumptions: string[] = []): string {
  return JSON.stringify({
    result: { action: 'sql', sql, tablesUsed: ['sales.store'], assumptions, explanation: 'Looks up the store.' },
  })
}
const clarifyReply = JSON.stringify({ result: { action: 'clarify', question: 'Which year?', options: ['2023', '2024'] } })
const cannotReply = JSON.stringify({ result: { action: 'cannot_answer', reason: 'Website visits are not in the data.' } })

class FakeGroqError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers,
  ) {
    super(`${status} status code`)
  }
}
const rateLimited = (seconds: string): FakeGroqError => new FakeGroqError(429, new Headers({ 'retry-after': seconds }))

interface Harness {
  deps: QuestionDeps
  provider: MockChatProvider
  embeddingProvider: MockEmbeddingProvider
  /** Structured (generate) requests: the user prompt and the response format. */
  generateCalls: () => { prompt: string; format: JsonResponseFormat | undefined }[]
  answerCalls: () => number
}

/** A fresh graph environment: new mock clients each time (a "new graph instance"). */
async function harness(generateReplies: MockReply[]): Promise<Harness> {
  const queue = [...generateReplies]
  const provider = createMockChatProvider((_messages, _model, format) => {
    if (format === undefined) return ANSWER
    return queue.shift() ?? new Error('unexpected generate call')
  }, classifyGroqRateLimit)
  const embeddingProvider = createMockEmbeddingProvider()
  const deps: QuestionDeps = {
    llm: createLlmClient(provider, { sleep: () => Promise.resolve() }),
    embeddings: createEmbeddingsClient(embeddingProvider),
    checkpointer: await getCheckpointer(),
  }
  return {
    deps,
    provider,
    embeddingProvider,
    generateCalls: () =>
      provider.requests
        .filter((r) => r.format !== undefined)
        .map((r) => ({ prompt: r.messages.map((m) => m.content).join('\n'), format: r.format })),
    answerCalls: () => provider.requests.filter((r) => r.format === undefined).length,
  }
}

async function ask(
  question: string,
  replies: MockReply[],
  options: RunOptions = { source: 'app' },
): Promise<{ id: string; outcome: RunOutcome; h: Harness }> {
  const h = await harness(replies)
  const { questionId } = await createQuestion({ question })
  return { id: questionId, outcome: await runQuestion(questionId, options, h.deps), h }
}

interface QuestionRow {
  status: string
  final_sql: string | null
  answer: string | null
  attempts: number
  error_code: string | null
  row_count: number | null
  assumptions: string[] | null
  trace: { node: string }[]
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number | null
  completed_at: Date | null
}

async function row(id: string): Promise<QuestionRow> {
  const result = await getAppPool().query<QuestionRow>('SELECT * FROM questions WHERE id = $1', [id])
  const found = result.rows[0]
  if (found === undefined) throw new Error('question row missing')
  return found
}

async function auditRules(id: string): Promise<string[]> {
  const result = await getAppPool().query<{ rule: string }>(
    'SELECT rule FROM audit_events WHERE question_id = $1 ORDER BY created_at',
    [id],
  )
  return result.rows.map((r) => r.rule)
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  )
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
})

beforeEach(async () => {
  await getAppPool().query('TRUNCATE audit_events, questions, conversations, daily_usage')
})

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

describe('agent graph paths (mock LLM)', () => {
  it('success: answers, persists the record and links audit rows to the question', async () => {
    const { id, outcome, h } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    expect(outcome).toMatchObject({ status: 'answered', answer: ANSWER, rowCount: 1, truncated: false, sql: CHEAP })
    if (outcome.status !== 'answered') throw new Error('not answered')
    expect(outcome.rows).toHaveLength(1)
    const r = await row(id)
    expect(r).toMatchObject({ status: 'answered', final_sql: CHEAP, answer: ANSWER, attempts: 1, error_code: null, row_count: 1 })
    expect(r.trace.map((t) => t.node)).toEqual([
      'input_guard', 'retrieve_context', 'generate', 'validate_sql', 'cost_check', 'execute', 'mask_output', 'answer',
    ])
    expect(r.prompt_tokens).toBeGreaterThan(0)
    expect(r.completion_tokens).toBeGreaterThan(0)
    expect(r.latency_ms).toBeGreaterThanOrEqual(0)
    expect(r.completed_at).not.toBeNull()
    expect(await auditRules(id)).toEqual(['POLICY_OK', 'COST_OK', 'EXECUTED'])
    expect(h.embeddingProvider.requests).toBe(1)
    expect(h.answerCalls()).toBe(1)
    expect(h.provider.requests.find((r) => r.format === undefined)?.model).toBe('answer-model')
  })

  it('never writes result rows into the checkpoint tables', async () => {
    const { outcome } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    if (outcome.status !== 'answered') throw new Error('not answered')
    const value = String(outcome.rows[0]?.[0])
    const found = await getAppPool().query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM checkpoint_blobs WHERE position($1 IN encode(blob, 'escape')) > 0)
             + (SELECT count(*) FROM checkpoint_writes WHERE position($1 IN encode(blob, 'escape')) > 0)
             + (SELECT count(*) FROM checkpoints WHERE checkpoint::text LIKE '%' || $1 || '%'))::int AS n`,
      [value],
    )
    expect(value.length).toBeGreaterThan(3)
    expect(found.rows[0]?.n).toBe(0)
  })

  it('parse error → retry → success, with the error shown to the model', async () => {
    const { id, outcome, h } = await ask('Which store has id 292?', [sqlReply('SELEC name FROM sales.store'), sqlReply(CHEAP)])
    expect(outcome.status).toBe('answered')
    expect((await row(id)).attempts).toBe(2)
    const calls = h.generateCalls()
    expect(calls).toHaveLength(2)
    expect(calls[1]?.prompt).toContain('Previous attempt:\nSQL: SELEC name FROM sales.store')
  })

  it('policy violation → blocked without retry', async () => {
    const { id, outcome, h } = await ask('Show password hashes', [sqlReply('SELECT passwordhash FROM person.password'), sqlReply(CHEAP)])
    expect(outcome).toMatchObject({ status: 'blocked', stage: 'validation', rule: 'TABLE_DENIED' })
    expect(h.generateCalls()).toHaveLength(1)
    expect(await row(id)).toMatchObject({ status: 'blocked', error_code: 'TABLE_DENIED', attempts: 1 })
    expect(await auditRules(id)).toEqual(['TABLE_DENIED'])
  })

  it('SQL error → retry with the database error → success', async () => {
    const { outcome, h } = await ask('Which store has id 292?', [sqlReply(SQL_ERROR), sqlReply(CHEAP)])
    expect(outcome.status).toBe('answered')
    expect(h.generateCalls()[1]?.prompt).toMatch(/Problem: division by zero/)
  })

  it('zero rows → one review; the model may confirm the same SQL', async () => {
    const { id, outcome, h } = await ask('Is there a store called No such store?', [sqlReply(ZERO_ROWS), sqlReply(ZERO_ROWS)])
    expect(outcome).toMatchObject({ status: 'answered', rowCount: 0 })
    const calls = h.generateCalls()
    expect(calls).toHaveLength(2)
    expect(calls[1]?.prompt).toContain(ZERO_ROW_REVIEW)
    expect((await row(id)).attempts).toBe(2)
  })

  it('max attempts → failed, and attempts never exceed MAX_SQL_ATTEMPTS', async () => {
    const { id, outcome, h } = await ask('Broken', [sqlReply(SQL_ERROR), sqlReply(SQL_ERROR), sqlReply(SQL_ERROR), sqlReply(CHEAP)])
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'MAX_ATTEMPTS' })
    expect(h.generateCalls()).toHaveLength(3)
    expect(await row(id)).toMatchObject({ status: 'failed', error_code: 'MAX_ATTEMPTS', attempts: 3 })
  })

  it('an invalid structured reply counts as an attempt and is shown to the model', async () => {
    const { id, outcome, h } = await ask('Which store has id 292?', ['not json', sqlReply(CHEAP)])
    expect(outcome.status).toBe('answered')
    expect((await row(id)).attempts).toBe(2)
    expect(h.generateCalls()[1]?.prompt).toContain('Previous reply problem: The reply was not valid JSON')
  })

  it('clarify → pause → resume in a new graph instance → answered', async () => {
    const first = await ask('Revenue for the year?', [clarifyReply])
    expect(first.outcome).toEqual({ status: 'awaiting_clarification', clarification: { question: 'Which year?', options: ['2023', '2024'] } })
    expect(await row(first.id)).toMatchObject({ status: 'awaiting_clarification', completed_at: null })

    const resumed = await harness([sqlReply(CHEAP)])
    const outcome = await resumeClarification(first.id, '2024', resumed.deps)
    expect(outcome.status).toBe('answered')
    expect(resumed.generateCalls()[0]?.prompt).toContain('Clarifications from the user:\nQ: Which year?\nA: 2024')
    expect(resumed.embeddingProvider.requests).toBe(0)
    const r = await row(first.id)
    expect(r.status).toBe('answered')
    expect(r.trace.map((t) => t.node)).toContain('clarify')
  })

  it('clarification limit → the model must assume (no clarify in the schema)', async () => {
    const first = await ask('Best customer?', [clarifyReply])
    const resumed = await harness([sqlReply(CHEAP, ['Best means highest revenue'])])
    const outcome = await resumeClarification(first.id, 'by revenue', resumed.deps)
    expect(outcome).toMatchObject({ status: 'answered', assumptions: ['Best means highest revenue'] })
    const call = resumed.generateCalls()[0]
    expect(call?.prompt).toContain(NO_MORE_CLARIFICATIONS)
    expect(JSON.stringify(call?.format)).not.toContain('clarify')
    expect((await row(first.id)).assumptions).toEqual(['Best means highest revenue'])
  })

  it('a clarify reply after the limit is invalid output, not another question', async () => {
    const first = await ask('Best customer?', [clarifyReply])
    const resumed = await harness([clarifyReply, sqlReply(CHEAP)])
    const outcome = await resumeClarification(first.id, 'by revenue', resumed.deps)
    expect(outcome.status).toBe('answered')
    expect(resumed.generateCalls()).toHaveLength(2)
  })

  it('approval approved → executes', async () => {
    const first = await ask('Units per product', [sqlReply(MEDIUM)])
    expect(first.outcome).toMatchObject({ status: 'awaiting_approval', approval: { softLimit: 1000 } })
    if (first.outcome.status !== 'awaiting_approval') throw new Error('expected approval')
    expect(first.outcome.approval.estimatedCost).toBeGreaterThan(1000)
    expect(first.outcome.approval.sql).toContain('LIMIT 21')
    expect((await row(first.id)).status).toBe('awaiting_approval')

    const resumed = await harness([])
    const outcome = await resumeApproval(first.id, true, resumed.deps)
    expect(outcome).toMatchObject({ status: 'answered', rowCount: 20, truncated: true })
    expect(await auditRules(first.id)).toEqual(['POLICY_OK', 'COST_SOFT_LIMIT', 'COST_APPROVED', 'EXECUTED'])
    expect(resumed.generateCalls()).toHaveLength(0)
  })

  it('approval denied → cancelled, nothing executed', async () => {
    const first = await ask('Units per product', [sqlReply(MEDIUM)])
    const outcome = await resumeApproval(first.id, false, (await harness([])).deps)
    expect(outcome).toEqual({ status: 'cancelled' })
    expect(await row(first.id)).toMatchObject({ status: 'cancelled' })
    expect(await auditRules(first.id)).toEqual(['POLICY_OK', 'COST_SOFT_LIMIT', 'APPROVAL_DENIED'])
  })

  it('above the hard limit → blocked', async () => {
    const { id, outcome } = await ask('Cross join', [sqlReply(HUGE)])
    expect(outcome).toMatchObject({ status: 'blocked', stage: 'cost', rule: 'COST_HARD_LIMIT' })
    expect((await row(id)).error_code).toBe('COST_HARD_LIMIT')
  })

  it('above the soft limit from MCP → blocked instead of approval', async () => {
    const { outcome } = await ask('Units per product', [sqlReply(MEDIUM)], { source: 'mcp' })
    expect(outcome).toMatchObject({ status: 'blocked', stage: 'cost', rule: 'COST_SOFT_LIMIT' })
  })

  it('cannot_answer', async () => {
    const { id, outcome } = await ask('How many website visits?', [cannotReply])
    expect(outcome).toEqual({ status: 'cannot_answer', reason: 'Website visits are not in the data.' })
    expect(await row(id)).toMatchObject({ status: 'cannot_answer', final_sql: null, attempts: 0 })
  })

  it('budget exceeded → failed with BUDGET_EXCEEDED before any provider call', async () => {
    await getAppPool().query(
      "INSERT INTO daily_usage (day, source, llm_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date, 'app', 1000000)",
    )
    const { id, outcome, h } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'BUDGET_EXCEEDED' })
    expect(h.provider.requests).toHaveLength(0)
    expect(await row(id)).toMatchObject({ status: 'failed', error_code: 'BUDGET_EXCEEDED' })
  })

  it('upstream 429 → waits for the provider delay and succeeds', async () => {
    const { outcome, h } = await ask('Which store has id 292?', [rateLimited('1'), sqlReply(CHEAP)])
    expect(outcome.status).toBe('answered')
    expect(h.generateCalls()).toHaveLength(2)
  })

  it('upstream 429 beyond the wait limit → UPSTREAM_RATE_LIMITED', async () => {
    const { id, outcome } = await ask('Which store has id 292?', [rateLimited('60')])
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'UPSTREAM_RATE_LIMITED' })
    expect((await row(id)).error_code).toBe('UPSTREAM_RATE_LIMITED')
  })

  it('input guard: control characters are stripped; an empty question fails without any call', async () => {
    const { id, outcome, h } = await ask('\u0000\u0007  \u001b ', [sqlReply(CHEAP)])
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'VALIDATION_ERROR' })
    expect(h.provider.requests).toHaveLength(0)
    expect((await row(id)).trace.map((t) => t.node)).toEqual(['input_guard'])

    const ok = await ask('Which store\u0007 has id 292?', [sqlReply(CHEAP)])
    expect(ok.outcome.status).toBe('answered')
    expect(ok.h.generateCalls()[0]?.prompt).toContain('Question: Which store has id 292?')
  })

  it('follow-up questions get the last answered turns as context', async () => {
    const first = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    const conversationId = (
      await getAppPool().query<{ conversation_id: string }>('SELECT conversation_id FROM questions WHERE id = $1', [first.id])
    ).rows[0]?.conversation_id
    const h = await harness([sqlReply(CHEAP)])
    const { questionId } = await createQuestion({ question: 'And its name in upper case?', conversationId })
    await runQuestion(questionId, { source: 'app' }, h.deps)
    expect(h.generateCalls()[0]?.prompt).toContain(`Earlier questions in this conversation:\nQ: Which store has id 292?\nSQL: ${CHEAP}`)
  })

  it('baseline flags: all tables, no embedding call, one attempt only', async () => {
    const flags: AgentFlags = { schemaRetrieval: false, examplesGlossaryValues: false, selfCorrection: false }
    const { id, outcome, h } = await ask('Broken', [sqlReply(SQL_ERROR), sqlReply(CHEAP)], { source: 'eval', flags })
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'MAX_ATTEMPTS' })
    expect(h.embeddingProvider.requests).toBe(0)
    expect(h.generateCalls()).toHaveLength(1)
    expect(h.generateCalls()[0]?.prompt).toContain('humanresources.department:')
    expect((await row(id)).attempts).toBe(1)
  })

  it('without self-correction there is no zero-row review', async () => {
    const flags: AgentFlags = { schemaRetrieval: true, examplesGlossaryValues: true, selfCorrection: false }
    const { outcome, h } = await ask('No such store?', [sqlReply(ZERO_ROWS)], { source: 'eval', flags })
    expect(outcome).toMatchObject({ status: 'answered', rowCount: 0 })
    expect(h.generateCalls()).toHaveLength(1)
  })
})

describe('resume and recovery rules', () => {
  it('rejects a resume in the wrong state (409) or for an unknown question (404)', async () => {
    const { id } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    const deps = (await harness([])).deps
    const wrong = await caught(resumeClarification(id, 'x', deps))
    expect(wrong instanceof AppError && wrong.code).toBe('INVALID_STATE')
    const approval = await caught(resumeApproval(id, true, deps))
    expect(approval instanceof AppError && approval.code).toBe('INVALID_STATE')
    const unknown = await caught(resumeApproval('00000000-0000-4000-8000-000000000000', true, deps))
    expect(unknown instanceof AppError && unknown.code).toBe('NOT_FOUND')
  })

  it('rejects an empty clarification answer', async () => {
    const { id } = await ask('Revenue for the year?', [clarifyReply])
    const err = await caught(resumeClarification(id, '   ', (await harness([])).deps))
    expect(err instanceof AppError && err.code).toBe('VALIDATION_ERROR')
    expect((await row(id)).status).toBe('awaiting_clarification')
  })

  it('marks stale running questions as INTERRUPTED and leaves paused and recent ones alone', async () => {
    const stale = await createQuestion({ question: 'stale' })
    const recent = await createQuestion({ question: 'recent' })
    const paused = await createQuestion({ question: 'paused' })
    await getAppPool().query("UPDATE questions SET created_at = now() - interval '10 minutes' WHERE id = ANY($1)", [
      [stale.questionId, paused.questionId],
    ])
    await getAppPool().query("UPDATE questions SET status = 'awaiting_approval' WHERE id = $1", [paused.questionId])
    expect(await recoverStaleRuns()).toBe(1)
    expect(await row(stale.questionId)).toMatchObject({ status: 'failed', error_code: 'INTERRUPTED' })
    expect((await row(recent.questionId)).status).toBe('running')
    expect((await row(paused.questionId)).status).toBe('awaiting_approval')
  })

  it('refuses to start a question twice', async () => {
    const { id } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    const err = await caught(runQuestion(id, { source: 'app' }, (await harness([])).deps))
    expect(err instanceof AppError && err.code).toBe('INVALID_STATE')
  })
})
