import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { getCheckpointer } from '../../src/agent/checkpointer.js'
import { dataRangeSql } from '../../src/agent/date-range.js'
import { classifyGroqRateLimit, createLlmClient } from '../../src/agent/llm.js'
import { createMockChatProvider, type MockChatProvider } from '../../src/agent/mock-llm.js'
import { DATA_RANGE_RULE, chosenPeriodRule } from '../../src/agent/prompts/answer.js'
import { periodChoiceLine, zeroRowReviewWithRange } from '../../src/agent/prompts/generate.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import type { TraceEntry } from '../../src/db/schema.js'
import { examplesFileSchema, glossaryFileSchema, readSeedFile, schemaFileSchema, seedPath } from '../../src/kb/seed-files.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { indexKnowledge } from '../../src/retrieval/indexer.js'
import { createMockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { createQuestion, resumeClarification, runQuestion, type QuestionDeps, type RunOutcome } from '../../src/services/question.service.js'
import { runSafeQuery, type SoftLimitPolicy } from '../../src/services/safe-query.service.js'
import { parseSql, referencedTables } from '../../src/safety/parser.js'

// The home page sample questions (client STARTER_CARDS, mirrored in
// test/fixtures/sample-questions.json; the client test keeps both in sync) must keep
// showing what their labels promise: the data must give each card (and the clarify
// card's follow-up) a non-empty result. A question about a year without data (§23
// moment 4, typed by hand) must never end as a bare "nothing matched": the agent
// looks up the date range and asks which period to use (IMPLEMENTATION.md 12.3).
// The real model is not called here (CLAUDE.md 11); its wording is checked by the
// approved real run recorded in PROGRESS.md.

vi.stubEnv('LLM_MODEL', 'main-model')
vi.stubEnv('LLM_ANSWER_MODEL', 'answer-model')
vi.stubEnv('MAX_SQL_ATTEMPTS', '3')
vi.stubEnv('MAX_CLARIFICATIONS', '1')
vi.stubEnv('QUESTION_MAX_LENGTH', '500')
vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')
// The server defaults (server/.env.example), which the approval card is measured against.
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '50000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '500000')
vi.stubEnv('QUERY_ROW_LIMIT', '100')
vi.stubEnv('PROVIDER_MAX_RETRIES', '2')
vi.stubEnv('PROVIDER_MAX_WAIT_MS', '5000')
vi.stubEnv('QUERY_TIMEOUT_MS', '5000')

const cardSchema = z.discriminatedUnion('behaviour', [
  z.object({ question: z.string(), shows: z.string(), behaviour: z.literal('count'), sql: z.string() }),
  z.object({ question: z.string(), shows: z.string(), behaviour: z.literal('chart'), sql: z.string() }),
  z.object({ question: z.string(), shows: z.string(), behaviour: z.literal('join'), sql: z.string() }),
  z.object({ question: z.string(), shows: z.string(), behaviour: z.literal('clarify'), followUpSql: z.string() }),
  z.object({ question: z.string(), shows: z.string(), behaviour: z.literal('approval'), sql: z.string() }),
  z.object({ question: z.string(), shows: z.string(), behaviour: z.literal('refused_write'), sql: z.string() }),
])

const fixtureSchema = z.object({
  dataRange: z.object({ schema: z.string(), table: z.string(), column: z.string(), min: z.string(), max: z.string(), hint: z.string() }),
  cards: z.array(cardSchema).length(6),
})

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(new URL('../fixtures/sample-questions.json', import.meta.url), 'utf8')))

type Card = z.infer<typeof cardSchema>
function card<B extends Card['behaviour']>(behaviour: B): Extract<Card, { behaviour: B }> {
  const found = fixture.cards.find((c): c is Extract<Card, { behaviour: B }> => c.behaviour === behaviour)
  if (found === undefined) throw new Error(`no ${behaviour} card`)
  return found
}

const run = (sql: string, softLimit: SoftLimitPolicy = 'require_approval'): ReturnType<typeof runSafeQuery> =>
  runSafeQuery({ sql, source: 'app', softLimit })

async function executedRows(sql: string): Promise<unknown[][]> {
  const result = await run(sql)
  if (result.status !== 'executed') throw new Error(`not executed: ${result.status === 'blocked' ? result.rule : result.status}`)
  return result.rows
}

// §23 moment 4 (typed by hand, no longer a home card): the zero-row date-range check (D99).
const EMPTY_YEAR = {
  question: 'Top 5 products by revenue in 2014.',
  sql: "SELECT p.name, sum(d.orderqty * d.unitprice * (1 - d.unitpricediscount)) AS revenue FROM sales.salesorderdetail d JOIN sales.salesorderheader h ON h.salesorderid = d.salesorderid JOIN production.product p ON p.productid = d.productid WHERE EXTRACT(YEAR FROM h.orderdate) = 2014 GROUP BY p.name ORDER BY revenue DESC LIMIT 5",
  chosenSql: "SELECT p.name, sum(d.orderqty * d.unitprice * (1 - d.unitpricediscount)) AS revenue FROM sales.salesorderdetail d JOIN sales.salesorderheader h ON h.salesorderid = d.salesorderid JOIN production.product p ON p.productid = d.productid WHERE EXTRACT(YEAR FROM h.orderdate) = 2023 GROUP BY p.name ORDER BY revenue DESC LIMIT 5",
}

const ANSWER = 'There is no data for 2014; sales data covers May 2022 to June 2025. For 2023, which you chose, the top product was Mountain-200 Black, 42.'

function sqlReply(sql: string, assumptions: string[] = []): string {
  return JSON.stringify({
    result: { action: 'sql', sql, tablesUsed: ['sales.salesorderheader'], assumptions, explanation: 'Top products by revenue.' },
  })
}

function clarifyReply(question: string, options: string[]): string {
  return JSON.stringify({ result: { action: 'clarify', question, options } })
}

/** A fresh graph environment with mock clients (a new graph instance per run segment). */
async function mockDeps(replies: string[]): Promise<{ deps: QuestionDeps; provider: MockChatProvider }> {
  const queue = [...replies]
  const provider = createMockChatProvider((_messages, _model, format) => {
    if (format === undefined) return ANSWER
    return queue.shift() ?? new Error('unexpected generate call')
  }, classifyGroqRateLimit)
  return {
    provider,
    deps: {
      llm: createLlmClient(provider, { sleep: () => Promise.resolve() }),
      embeddings: createEmbeddingsClient(createMockEmbeddingProvider()),
      checkpointer: await getCheckpointer(),
    },
  }
}

async function askWithMock(question: string, replies: string[]): Promise<{ id: string; outcome: RunOutcome; provider: MockChatProvider }> {
  const { deps, provider } = await mockDeps(replies)
  const { questionId } = await createQuestion({ question })
  return { id: questionId, outcome: await runQuestion(questionId, { source: 'app' }, deps), provider }
}

async function resumeWithMock(id: string, answer: string, replies: string[]): Promise<{ outcome: RunOutcome; provider: MockChatProvider }> {
  const { deps, provider } = await mockDeps(replies)
  return { outcome: await resumeClarification(id, answer, deps), provider }
}

const prompts = (provider: MockChatProvider, kind: 'generate' | 'answer'): string[] =>
  provider.requests
    .filter((r) => (kind === 'generate' ? r.format !== undefined : r.format === undefined))
    .map((r) => r.messages.map((m) => m.content).join('\n'))

async function auditFor(id: string): Promise<{ rule: string; sql: string | null }[]> {
  const result = await getAppPool().query<{ rule: string; sql: string | null }>(
    'SELECT rule, sql FROM audit_events WHERE question_id = $1 ORDER BY created_at',
    [id],
  )
  return result.rows
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
  await getAppPool().query('TRUNCATE feedback, audit_events, questions, conversations, daily_usage')
})

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

describe('home page sample questions', () => {
  it('the hint states the real sales date range', async () => {
    const { schema, table, column, min, max } = fixture.dataRange
    expect(await executedRows(dataRangeSql({ schema, table, column }))).toEqual([[min, max]])
  })

  it('the count card has a non-empty count', async () => {
    const rows = await executedRows(card('count').sql)
    expect(rows).toHaveLength(1)
    expect(Number(rows[0]?.[0])).toBeGreaterThan(0)
  })

  it('the chart card has chartable rows: one text column and numbers, at most 50 rows', async () => {
    const result = await run(card('chart').sql)
    if (result.status !== 'executed') throw new Error('not executed')
    expect(result.rowCount).toBeGreaterThan(0)
    expect(result.rowCount).toBeLessThanOrEqual(50)
    const [label, ...measures] = result.columns
    expect(label?.type).toMatch(/text|character varying|name/)
    expect(measures.length).toBeGreaterThanOrEqual(1)
    expect(measures.length).toBeLessThanOrEqual(3)
    for (const r of result.rows) for (const value of r.slice(1)) expect(Number(value)).toBeGreaterThan(0)
  })

  it('the approval card is above the soft limit and below the hard limit', async () => {
    const result = await run(card('approval').sql)
    expect(result.status).toBe('needs_approval')
    if (result.status !== 'needs_approval') return
    expect(result.cost).toBeGreaterThan(50000)
    expect(result.cost).toBeLessThan(500000)
    // Approved (eval policy 'allow' stands in for the user's approval): finishes within QUERY_TIMEOUT_MS.
    const approved = await run(card('approval').sql, 'allow')
    expect(approved).toMatchObject({ status: 'executed', rowCount: 10 })
    if (approved.status !== 'executed') return
    for (const r of approved.rows) {
      expect(typeof r[0]).toBe('string')
      expect(r[0]).not.toBe(r[1])
      expect(Number(r[2])).toBeGreaterThan(0)
    }
  })

  it('the join card reads at least three tables and returns five people with sales', async () => {
    const c = card('join')
    const parsed = await parseSql(c.sql)
    if (!parsed.ok || parsed.statements[0] === undefined) throw new Error('reference SQL does not parse')
    expect(referencedTables(parsed.statements[0]).length).toBeGreaterThanOrEqual(3)
    const rows = await executedRows(c.sql)
    expect(rows).toHaveLength(5)
    for (const r of rows) expect(Number(r[2])).toBeGreaterThan(0)
  })

  it('the clarify card: the follow-up periods (2023 vs 2024) both have sales', async () => {
    const rows = await executedRows(card('clarify').followUpSql)
    expect(rows).toHaveLength(1)
    for (const value of rows[0] ?? []) expect(Number(value)).toBeGreaterThan(0)
  })

  it('the refused-write card can never execute a write', async () => {
    expect(await run(card('refused_write').sql)).toMatchObject({ status: 'blocked', rule: 'NOT_SELECT' })
  })

})

describe('zero-row date-range check (§23 moment 4, D99, D103)', () => {
  const { schema, table, column, min, max } = fixture.dataRange
  const range = { schema, table, column, min, max }
  const NO_DATA_QUESTION = 'There is no data for 2014; the data covers May 2022 to June 2025. Which period should I use?'
  const OPTIONS = ['2023', '2024', 'All available data (May 2022 to June 2025)']

  it('the 2014 question is empty for its year, and a year the user can choose has rows', async () => {
    expect(await executedRows(EMPTY_YEAR.sql)).toEqual([])
    expect((await executedRows(EMPTY_YEAR.chosenSql)).length).toBeGreaterThan(0)
  })

  it('looks up the range, asks which period to use, and answers for the period the user chose', async () => {
    const c = EMPTY_YEAR
    const first = await askWithMock(c.question, [sqlReply(c.sql), clarifyReply(NO_DATA_QUESTION, OPTIONS)])
    // No other period is used without asking: the run pauses with the range and concrete options.
    expect(first.outcome).toEqual({ status: 'awaiting_clarification', clarification: { question: NO_DATA_QUESTION, options: OPTIONS } })
    expect(prompts(first.provider, 'generate')[1]).toContain(zeroRowReviewWithRange(range, true))
    expect(prompts(first.provider, 'answer')).toHaveLength(0)
    // The range query went through the audited safety pipeline after the empty result.
    const audit = await auditFor(first.id)
    expect(audit.map((a) => a.rule)).toEqual(['POLICY_OK', 'COST_OK', 'EXECUTED', 'POLICY_OK', 'COST_OK', 'EXECUTED'])
    expect(audit[3]?.sql).toBe(dataRangeSql(range))

    const resumed = await resumeWithMock(first.id, '2023', [sqlReply(c.chosenSql)])
    expect(resumed.outcome).toMatchObject({ status: 'answered', sql: c.chosenSql })
    if (resumed.outcome.status !== 'answered') return
    expect(resumed.outcome.rowCount).toBeGreaterThan(0)
    const generatePrompt = prompts(resumed.provider, 'generate')[0]
    expect(generatePrompt).toContain(`Clarifications from the user:\nQ: ${NO_DATA_QUESTION}\nA: 2023`)
    // The user's choice replaces the question's period; the review feedback is not repeated.
    expect(generatePrompt).toContain(periodChoiceLine({ range, answer: '2023' }))
    expect(generatePrompt).not.toContain('Previous attempt:')
    const answerPrompt = prompts(resumed.provider, 'answer')[0]
    expect(answerPrompt).toContain(`Data range: ${schema}.${table}.${column} has values from ${min} to ${max} (May 2022 to June 2025)`)
    expect(answerPrompt).toContain('Period chosen by the user instead: 2023')
    expect(answerPrompt).toContain(chosenPeriodRule(range, '2023'))
    const record = (await getAppPool().query<{ trace: TraceEntry[]; attempts: number }>('SELECT trace, attempts FROM questions WHERE id = $1', [first.id])).rows[0]
    expect(record?.attempts).toBe(2)
    expect(record?.trace.find((t) => t.node === 'execute')?.detail).toMatchObject({ rowCount: 0, dataRange: range })
  })

  it('with no clarification left, the review keeps the period and the answer states the range', async () => {
    const c = EMPTY_YEAR
    // MAX_CLARIFICATIONS is 1 here: an earlier question uses it up.
    const first = await askWithMock(c.question, [clarifyReply('Revenue or units?', ['Revenue', 'Units'])])
    expect(first.outcome.status).toBe('awaiting_clarification')
    const resumed = await resumeWithMock(first.id, 'Revenue', [sqlReply(c.sql), sqlReply(c.sql)])
    expect(resumed.outcome).toMatchObject({ status: 'answered', rowCount: 0 })
    expect(prompts(resumed.provider, 'generate')[1]).toContain(zeroRowReviewWithRange(range, false))
    // The earlier clarification was not about the period, so it is not a period choice.
    expect(prompts(resumed.provider, 'generate')[1]).not.toContain('Period chosen by the user')
    expect(prompts(resumed.provider, 'answer')[0]).toContain(DATA_RANGE_RULE)
    expect(prompts(resumed.provider, 'answer')[0]).not.toContain('Period chosen')
  })

  it('if the model keeps the empty year anyway, the answer prompt still states the range', async () => {
    const { outcome, provider } = await askWithMock(EMPTY_YEAR.question, [sqlReply(EMPTY_YEAR.sql), sqlReply(EMPTY_YEAR.sql)])
    expect(outcome).toMatchObject({ status: 'answered', rowCount: 0 })
    const answerPrompt = prompts(provider, 'answer')[0]
    expect(answerPrompt).toContain(`has values from ${min} to ${max} (May 2022 to June 2025)`)
    expect(answerPrompt).toContain(DATA_RANGE_RULE)
  })
})
