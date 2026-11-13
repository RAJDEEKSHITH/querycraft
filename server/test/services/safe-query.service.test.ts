import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { recordAuditEvent } from '../../src/services/audit.service.js'
import { runSafeQuery, type SafeQueryInput } from '../../src/services/safe-query.service.js'

// The whole pipeline against querycraft_test (audit) and adventureworks (reader).
// M1 acceptance: each decision writes exactly one audit row.

// Fixed limits for this file, set before the env is first read (env is cached per test file).
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '1000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '100000')
vi.stubEnv('QUERY_ROW_LIMIT', '20')

// Plan costs measured on AdventureWorks: ~8, ~3 300 and ~2.2e8.
const CHEAP = 'SELECT name FROM sales.store WHERE businessentityid = 292'
const MEDIUM = 'SELECT productid, sum(orderqty) FROM sales.salesorderdetail GROUP BY productid'
const HUGE = 'SELECT count(*) FROM sales.salesorderdetail a, sales.salesorderdetail b'

interface AuditRow {
  question_id: string | null
  source: string
  stage: string
  decision: string
  rule: string
  sql: string | null
  detail: Record<string, unknown>
}

async function auditRows(): Promise<AuditRow[]> {
  const result = await getAppPool().query<AuditRow>(
    'SELECT question_id, source, stage, decision, rule, sql, detail FROM audit_events ORDER BY created_at',
  )
  return result.rows
}

function run(sql: string, overrides: Partial<SafeQueryInput> = {}): ReturnType<typeof runSafeQuery> {
  return runSafeQuery({ sql, source: 'app', softLimit: 'require_approval', ...overrides })
}

beforeEach(async () => {
  await getAppPool().query('TRUNCATE audit_events')
})

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

describe('recordAuditEvent', () => {
  it('writes one row with all fields', async () => {
    const questionId = randomUUID()
    await recordAuditEvent({
      questionId,
      source: 'eval',
      stage: 'cost',
      decision: 'needs_approval',
      rule: 'COST_SOFT_LIMIT',
      message: 'm',
      sql: 'SELECT 1',
      detail: { cost: 1 },
    })
    expect(await auditRows()).toEqual([
      {
        question_id: questionId,
        source: 'eval',
        stage: 'cost',
        decision: 'needs_approval',
        rule: 'COST_SOFT_LIMIT',
        sql: 'SELECT 1',
        detail: { cost: 1 },
      },
    ])
  })
})

describe('runSafeQuery', () => {
  it('blocks a policy violation with one validation row', async () => {
    const result = await run('SELECT * FROM person.password')
    expect(result).toMatchObject({ status: 'blocked', stage: 'validation', rule: 'TABLE_DENIED', retryable: false })
    expect(await auditRows()).toMatchObject([
      { stage: 'validation', decision: 'blocked', rule: 'TABLE_DENIED', sql: 'SELECT * FROM person.password' },
    ])
  })

  it('marks a parse error retryable', async () => {
    expect(await run('SELEC 1')).toMatchObject({ status: 'blocked', rule: 'PARSE_ERROR', retryable: true })
    expect(await auditRows()).toHaveLength(1)
  })

  it('executes a cheap query with one row per decision and the rewritten SQL', async () => {
    const result = await run(CHEAP)
    expect(result).toMatchObject({ status: 'executed', rowCount: 1, truncated: false })
    const rows = await auditRows()
    expect(rows.map((r) => [r.stage, r.decision, r.rule])).toEqual([
      ['validation', 'allowed', 'POLICY_OK'],
      ['cost', 'allowed', 'COST_OK'],
      ['execution', 'allowed', 'EXECUTED'],
    ])
    expect(rows[0]?.sql).toBe(CHEAP)
    expect(rows[1]?.sql).toMatch(/LIMIT 21$/)
    expect(rows[2]?.detail).toMatchObject({ rowCount: 1, truncated: false })
  })

  it('caps rows at QUERY_ROW_LIMIT and reports truncation', async () => {
    const result = await run('SELECT productid FROM production.product')
    expect(result).toMatchObject({ status: 'executed', rowCount: 20, truncated: true })
  })

  it('returns masked PII', async () => {
    const result = await run('SELECT emailaddress AS contact FROM person.emailaddress ORDER BY businessentityid LIMIT 2')
    if (result.status !== 'executed') throw new Error(result.status)
    for (const [value] of result.rows) expect(value).toMatch(/^.\*\*\*@adventure-works\.com$/)
  })

  it('asks for approval above the soft limit (app)', async () => {
    const result = await run(MEDIUM)
    expect(result).toMatchObject({ status: 'needs_approval', softLimit: 1000 })
    expect((await auditRows()).map((r) => [r.stage, r.decision, r.rule])).toEqual([
      ['validation', 'allowed', 'POLICY_OK'],
      ['cost', 'needs_approval', 'COST_SOFT_LIMIT'],
    ])
  })

  it('blocks above the soft limit when the caller treats it as hard (MCP)', async () => {
    const result = await run(MEDIUM, { source: 'mcp', softLimit: 'block' })
    expect(result).toMatchObject({ status: 'blocked', stage: 'cost', rule: 'COST_SOFT_LIMIT' })
    expect((await auditRows()).map((r) => [r.source, r.stage, r.decision, r.rule])).toEqual([
      ['mcp', 'validation', 'allowed', 'POLICY_OK'],
      ['mcp', 'cost', 'blocked', 'COST_SOFT_LIMIT'],
    ])
  })

  it('runs above the soft limit when approved, recording COST_APPROVED', async () => {
    const result = await run(MEDIUM, { softLimit: 'allow' })
    expect(result).toMatchObject({ status: 'executed' })
    expect((await auditRows()).map((r) => r.rule)).toEqual(['POLICY_OK', 'COST_APPROVED', 'EXECUTED'])
  })

  it('blocks above the hard limit even when approved', async () => {
    const result = await run(HUGE, { softLimit: 'allow' })
    expect(result).toMatchObject({ status: 'blocked', stage: 'cost', rule: 'COST_HARD_LIMIT', retryable: false })
    const rows = await auditRows()
    expect(rows.map((r) => r.rule)).toEqual(['POLICY_OK', 'COST_HARD_LIMIT'])
    expect(rows[1]?.detail).toMatchObject({ softLimit: 1000, hardLimit: 100000 })
  })

  it('returns a planning error as retryable with the database error for the agent', async () => {
    const result = await run('SELECT no_such_column FROM sales.store')
    expect(result).toMatchObject({
      status: 'blocked',
      stage: 'cost',
      rule: 'PLAN_ERROR',
      retryable: true,
      message: 'The database rejected the query',
      dbError: { sqlState: '42703' },
    })
    const rows = await auditRows()
    expect(rows.map((r) => r.rule)).toEqual(['POLICY_OK', 'PLAN_ERROR'])
    expect(rows[1]?.detail).toMatchObject({ sqlState: '42703' })
  })

  it('returns a runtime error as retryable EXECUTION_ERROR', async () => {
    const result = await run('SELECT 1 / (listprice - listprice) FROM production.product')
    expect(result).toMatchObject({ status: 'blocked', stage: 'execution', rule: 'EXECUTION_ERROR', retryable: true })
    expect((await auditRows()).map((r) => r.rule)).toEqual(['POLICY_OK', 'COST_OK', 'EXECUTION_ERROR'])
  })

  it('records source and question id on every row', async () => {
    const questionId = randomUUID()
    await run(CHEAP, { source: 'eval', questionId })
    const rows = await auditRows()
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row).toMatchObject({ source: 'eval', question_id: questionId })
  })
})
