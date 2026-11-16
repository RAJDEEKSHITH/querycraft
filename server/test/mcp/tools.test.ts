import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { getCheckpointer } from '../../src/agent/checkpointer.js'
import { classifyGroqRateLimit, createLlmClient } from '../../src/agent/llm.js'
import { createMockChatProvider, type MockReply } from '../../src/agent/mock-llm.js'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { examplesFileSchema, glossaryFileSchema, readSeedFile, schemaFileSchema, seedPath } from '../../src/kb/seed-files.js'
import { createMcpServer } from '../../src/mcp/tools.js'
import { createEmbeddingsClient } from '../../src/retrieval/embeddings.js'
import { indexKnowledge } from '../../src/retrieval/indexer.js'
import { createMockEmbeddingProvider } from '../../src/retrieval/mock-embeddings.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { captureLogger } from '../helpers/log-capture.js'

// MCP server (IMPLEMENTATION.md 16, M7 acceptance): an SDK client over the SDK's
// in-memory transport lists and calls every tool against querycraft_test and
// adventureworks, with the mock LLM and mock embeddings. Attacks through
// run_safe_query are blocked and audited with source = mcp.

vi.stubEnv('LLM_MODEL', 'main-model')
vi.stubEnv('LLM_ANSWER_MODEL', 'answer-model')
vi.stubEnv('MAX_SQL_ATTEMPTS', '3')
vi.stubEnv('MAX_CLARIFICATIONS', '1')
vi.stubEnv('QUESTION_MAX_LENGTH', '500')
vi.stubEnv('DAILY_TOKEN_BUDGET', '1000000')
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '1000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '100000')
vi.stubEnv('QUERY_ROW_LIMIT', '500')

// Plan costs on AdventureWorks: ~8, ~3 300 (above the soft limit) and ~2.2e8 (above the hard limit).
const CHEAP = 'SELECT name FROM sales.store WHERE businessentityid = 292'
const MEDIUM = 'SELECT productid, sum(orderqty) AS units FROM sales.salesorderdetail GROUP BY productid'
const HUGE = 'SELECT count(*) FROM sales.salesorderdetail a, sales.salesorderdetail b'
const EMAIL = 'SELECT emailaddress FROM person.emailaddress WHERE businessentityid = 1'
// Priced products: more than the 100 rows an MCP call returns, fewer than the row limit (500).
const MANY = 'SELECT productid, name FROM production.product WHERE listprice > 0 ORDER BY productid'
const MANY_COUNT = 'SELECT count(*)::int AS n FROM production.product WHERE listprice > 0'
const ANSWER = 'The store is Next-Door Bike Shop.'
const LEAKY_ERROR = 'provider exploded: password=hunter2 at /srv/app/secret.js:10'

function sqlReply(sql: string): string {
  return JSON.stringify({
    result: { action: 'sql', sql, tablesUsed: ['sales.store'], assumptions: ['Store 292'], explanation: 'Looks up the store.' },
  })
}
const clarifyReply = JSON.stringify({ result: { action: 'clarify', question: 'Which year?', options: ['2023', '2024'] } })
const cannotReply = JSON.stringify({ result: { action: 'cannot_answer', reason: 'Website visits are not in the data.' } })

let queue: MockReply[] = []
const provider = createMockChatProvider((_messages, _model, format) => {
  if (format === undefined) return ANSWER
  return queue.shift() ?? new Error('unexpected generate call')
}, classifyGroqRateLimit)

const toolResult = z.object({
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })).length(1),
  isError: z.boolean().optional(),
})

let client: Client
/** Every tool result text of this file, scanned at the end for leaks. */
const texts: string[] = []

async function callText(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; text: string }> {
  const parsed = toolResult.parse(await client.callTool({ name, arguments: args }))
  const text = parsed.content[0]?.text ?? ''
  texts.push(text)
  return { isError: parsed.isError ?? false, text }
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; data: Record<string, unknown> }> {
  const { isError, text } = await callText(name, args)
  return { isError, data: z.record(z.string(), z.unknown()).parse(JSON.parse(text)) }
}

async function ask(question: string, replies: MockReply[]): Promise<{ isError: boolean; data: Record<string, unknown> }> {
  queue = [...replies]
  return call('ask_question', { question })
}

interface AuditRow {
  source: string
  stage: string
  decision: string
  rule: string
}

async function auditFor(sql: string): Promise<AuditRow[]> {
  const result = await getAppPool().query<AuditRow>(
    'SELECT source, stage, decision, rule FROM audit_events WHERE sql = $1 ORDER BY created_at',
    [sql],
  )
  return result.rows
}

/** Every audit row (the table is emptied before each test); cost rows hold the row-limited SQL. */
async function allAudit(): Promise<AuditRow[]> {
  const result = await getAppPool().query<AuditRow>('SELECT source, stage, decision, rule FROM audit_events ORDER BY created_at')
  return result.rows
}

/** Rows MANY returns without the MCP cut. */
async function manyCount(): Promise<number> {
  const { data } = await call('run_safe_query', { sql: MANY_COUNT })
  const n = z.array(z.tuple([z.number()])).parse(data['rows'])[0]?.[0]
  if (n === undefined) throw new Error('no count')
  return n
}

async function questionAudit(questionId: unknown): Promise<AuditRow[]> {
  const result = await getAppPool().query<AuditRow>(
    'SELECT source, stage, decision, rule FROM audit_events WHERE question_id = $1 ORDER BY created_at',
    [questionId],
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
  const { logger } = captureLogger()
  const server = createMcpServer(
    {
      llm: createLlmClient(provider, { sleep: () => Promise.resolve() }),
      embeddings: createEmbeddingsClient(createMockEmbeddingProvider()),
      checkpointer: await getCheckpointer(),
    },
    logger,
  )
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'querycraft-test', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
})

beforeEach(async () => {
  await getAppPool().query('TRUNCATE feedback, audit_events, questions, conversations, daily_usage')
  queue = []
})

afterAll(async () => {
  await client.close()
  await closeReaderConnections()
  await closeAppPool()
})

describe('tool list', () => {
  it('lists the four tools with their inputs, all read-only', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['ask_question', 'describe_table', 'list_tables', 'run_safe_query'])
    const inputs = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema.required ?? []]))
    expect(inputs).toEqual({ list_tables: [], describe_table: ['schema', 'table'], run_safe_query: ['sql'], ask_question: ['question'] })
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })
})

describe('list_tables', () => {
  it('returns the allowed tables with descriptions and never person.password', async () => {
    const { isError, text } = await callText('list_tables')
    expect(isError).toBe(false)
    const tables = z.array(z.object({ schema: z.string(), table: z.string(), description: z.string() })).parse(JSON.parse(text))
    expect(tables).toHaveLength(67)
    expect(tables).toContainEqual({ schema: 'sales', table: 'store', description: 'The store table' })
    expect(tables.some((t) => t.table === 'password')).toBe(false)
  })
})

describe('describe_table', () => {
  it('lists columns and types, omits denied columns', async () => {
    const { isError, data } = await call('describe_table', { schema: 'humanresources', table: 'employee' })
    expect(isError).toBe(false)
    const columns = z.array(z.object({ name: z.string(), type: z.string(), pii: z.string().nullable() })).parse(data['columns'])
    const names = columns.map((c) => c.name)
    expect(names).toContain('jobtitle')
    expect(names).not.toContain('nationalidnumber')
    expect(names).not.toContain('loginid')
  })

  it('flags PII columns and shows foreign keys', async () => {
    const { data } = await call('describe_table', { schema: 'person', table: 'emailaddress' })
    const columns = z.array(z.object({ name: z.string(), pii: z.string().nullable(), references: z.string().nullable() })).parse(data['columns'])
    expect(columns.find((c) => c.name === 'emailaddress')?.pii).toBe('email')
    expect(columns.find((c) => c.name === 'businessentityid')).toMatchObject({ pii: null, references: 'person.person.businessentityid' })
  })

  it('refuses unknown and denied tables', async () => {
    for (const args of [{ schema: 'sales', table: 'nope' }, { schema: 'person', table: 'password' }]) {
      const { isError, data } = await call('describe_table', args)
      expect(isError).toBe(true)
      expect(data).toEqual({ status: 'error', code: 'NOT_FOUND', message: `Table ${args.schema}.${args.table} is not available` })
    }
  })
})

describe('run_safe_query', () => {
  it('runs a safe query and audits each stage with source = mcp', async () => {
    const { isError, data } = await call('run_safe_query', { sql: CHEAP })
    expect(isError).toBe(false)
    expect(data).toMatchObject({ status: 'executed', rows: [['Next-Door Bike Store']], rowCount: 1, truncated: false })
    expect(await auditFor(CHEAP)).toEqual([{ source: 'mcp', stage: 'validation', decision: 'allowed', rule: 'POLICY_OK' }])
    const all = await getAppPool().query<{ source: string; rule: string }>('SELECT source, rule FROM audit_events ORDER BY created_at')
    expect(all.rows).toEqual([
      { source: 'mcp', rule: 'POLICY_OK' },
      { source: 'mcp', rule: 'COST_OK' },
      { source: 'mcp', rule: 'EXECUTED' },
    ])
  })

  it('returns at most 100 rows and marks the result truncated', async () => {
    const total = await manyCount()
    expect(total).toBeGreaterThan(100)
    expect(total).toBeLessThan(500)
    const { data } = await call('run_safe_query', { sql: MANY })
    expect(data).toMatchObject({ status: 'executed', rowCount: total, truncated: true })
    expect(data['rows']).toHaveLength(100)
  })

  it('masks PII in the rows', async () => {
    const { data } = await call('run_safe_query', { sql: EMAIL })
    const rows = z.array(z.array(z.string())).parse(data['rows'])
    expect(rows[0]?.[0]).toMatch(/^k\*+@adventure-works\.com$/)
  })

  it.each([
    ['a write', 'DELETE FROM sales.store', 'validation', 'NOT_SELECT'],
    ['two statements', 'SELECT 1; DROP TABLE sales.store', 'validation', 'MULTIPLE_STATEMENTS'],
    ['a denied table', 'SELECT * FROM person.password', 'validation', 'TABLE_DENIED'],
    ['a denied column', 'SELECT nationalidnumber FROM humanresources.employee', 'validation', 'COLUMN_DENIED'],
    ['a dangerous function', 'SELECT pg_sleep(10)', 'validation', 'FUNCTION_NOT_ALLOWED'],
    ['a query above the hard cost limit', HUGE, 'cost', 'COST_HARD_LIMIT'],
    ['a query above the soft cost limit (hard for MCP)', MEDIUM, 'cost', 'COST_SOFT_LIMIT'],
  ])('blocks %s and audits it with source = mcp', async (_label, sql, stage, rule) => {
    const { isError, data } = await call('run_safe_query', { sql })
    expect(isError).toBe(true)
    expect(data).toMatchObject({ status: 'blocked', stage, rule })
    expect(data).not.toHaveProperty('rows')
    const audit = await allAudit()
    expect(audit.at(-1)).toEqual({ source: 'mcp', stage, decision: 'blocked', rule })
    expect(audit.some((a) => a.rule === 'EXECUTED')).toBe(false)
  })

  it('leaves the data unchanged after the write attempt', async () => {
    const before = await call('run_safe_query', { sql: 'SELECT count(*) AS n FROM sales.store' })
    await call('run_safe_query', { sql: 'DELETE FROM sales.store' })
    const after = await call('run_safe_query', { sql: 'SELECT count(*) AS n FROM sales.store' })
    expect(after.data['rows']).toEqual(before.data['rows'])
  })

  it('rejects missing or empty input without running anything', async () => {
    for (const args of [{}, { sql: '' }]) {
      const { isError, text } = await callText('run_safe_query', args)
      expect(isError).toBe(true)
      expect(text).toContain('Input validation error')
    }
    const audit = await getAppPool().query('SELECT 1 FROM audit_events')
    expect(audit.rowCount).toBe(0)
  })
})

describe('ask_question', () => {
  it('answers through the agent with source = mcp', async () => {
    const { isError, data } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    expect(isError).toBe(false)
    expect(data).toMatchObject({
      status: 'answered',
      answer: ANSWER,
      sql: CHEAP,
      assumptions: ['Store 292'],
      rows: [['Next-Door Bike Store']],
      rowCount: 1,
      truncated: false,
    })
    const audit = await questionAudit(data['questionId'])
    expect(audit.map((a) => a.rule)).toEqual(['POLICY_OK', 'COST_OK', 'EXECUTED'])
    expect(audit.every((a) => a.source === 'mcp')).toBe(true)
    const usage = await getAppPool().query<{ source: string; llm_requests: number }>('SELECT source, llm_requests FROM daily_usage')
    expect(usage.rows).toEqual([{ source: 'mcp', llm_requests: 2 }])
  })

  it('returns at most 100 answer rows', async () => {
    const total = await manyCount()
    const { data } = await ask('List priced products', [sqlReply(MANY)])
    expect(data).toMatchObject({ status: 'answered', rowCount: total, truncated: true })
    expect(data['rows']).toHaveLength(100)
  })

  it('returns a clarification as text (not an error)', async () => {
    const { isError, data } = await ask('How did sales change?', [clarifyReply])
    expect(isError).toBe(false)
    expect(data).toMatchObject({ status: 'clarification_needed', question: 'Which year?', options: ['2023', '2024'] })
  })

  it('refuses a query above the soft cost limit with the estimate', async () => {
    const { isError, data } = await ask('Units per product', [sqlReply(MEDIUM)])
    expect(isError).toBe(true)
    expect(data).toMatchObject({ status: 'approval_required', softLimit: 1000 })
    expect(data['estimatedCost']).toBeGreaterThan(1000)
    expect(data['message']).toContain('MCP cannot approve it')
    const audit = await questionAudit(data['questionId'])
    expect(audit.at(-1)).toEqual({ source: 'mcp', stage: 'cost', decision: 'blocked', rule: 'COST_SOFT_LIMIT' })
  })

  it('returns cannot_answer as text', async () => {
    const { isError, data } = await ask('How many people visited our website?', [cannotReply])
    expect(isError).toBe(false)
    expect(data).toMatchObject({ status: 'cannot_answer', reason: 'Website visits are not in the data.' })
  })

  it('blocks a write the model produces and audits it with source = mcp', async () => {
    const { isError, data } = await ask('Delete all stores', [sqlReply('DELETE FROM sales.store')])
    expect(isError).toBe(true)
    expect(data).toMatchObject({ status: 'blocked', stage: 'validation', rule: 'NOT_SELECT' })
    expect(await questionAudit(data['questionId'])).toEqual([
      { source: 'mcp', stage: 'validation', decision: 'blocked', rule: 'NOT_SELECT' },
    ])
  })

  it('refuses when the daily token budget (app + MCP) is used up, before any LLM call', async () => {
    await getAppPool().query(
      `INSERT INTO daily_usage (day, source, llm_tokens, embedding_tokens, llm_requests, embedding_requests, cost_usd)
       VALUES ((now() AT TIME ZONE 'UTC')::date, 'app', 1000000, 0, 1, 0, 0)`,
    )
    const requestsBefore = provider.requests.length
    const { isError, data } = await ask('Which store has id 292?', [sqlReply(CHEAP)])
    expect(isError).toBe(true)
    expect(data).toMatchObject({ status: 'error', code: 'BUDGET_EXCEEDED' })
    expect(provider.requests.length).toBe(requestsBefore)
  })

  it('returns a safe message when the provider fails', async () => {
    const { isError, data } = await ask('Which store has id 292?', [new Error(LEAKY_ERROR)])
    expect(isError).toBe(true)
    expect(data).toMatchObject({ status: 'failed' })
  })

  it('rejects an empty question', async () => {
    const { isError, text } = await callText('ask_question', { question: '' })
    expect(isError).toBe(true)
    expect(text).toContain('Input validation error')
  })
})

describe('leaks', () => {
  it('never returns raw provider errors, secrets or stack traces', () => {
    const all = texts.join('\n')
    expect(all).not.toContain('hunter2')
    expect(all).not.toContain('secret.js')
    expect(all).not.toMatch(/\bat .+:\d+:\d+/)
  })
})
