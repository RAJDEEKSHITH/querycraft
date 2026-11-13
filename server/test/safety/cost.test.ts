import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { classifyCost, explainCost } from '../../src/safety/cost.js'
import { closeReaderConnections, executeQuery } from '../../src/safety/executor.js'
import { validateSql } from '../../src/safety/validate.js'
import { loadSafeCases } from '../helpers/sql-cases.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

afterAll(async () => {
  await closeReaderConnections()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('classifyCost', () => {
  const limits = { soft: 1_000, hard: 100_000 }

  it('is ok up to and including the soft limit', () => {
    expect(classifyCost(0, limits)).toBe('ok')
    expect(classifyCost(1_000, limits)).toBe('ok')
  })

  it('is over_soft above the soft limit up to and including the hard limit', () => {
    expect(classifyCost(1_000.01, limits)).toBe('over_soft')
    expect(classifyCost(100_000, limits)).toBe('over_soft')
  })

  it('is over_hard above the hard limit', () => {
    expect(classifyCost(100_000.01, limits)).toBe('over_hard')
  })
})

describe('explainCost', () => {
  it('returns the planner total cost', async () => {
    const result = await explainCost('SELECT name FROM sales.store WHERE businessentityid = 292', 5_000)
    expect(result.ok && result.totalCost).toBeGreaterThan(0)
    const cross = await explainCost('SELECT count(*) FROM sales.salesorderdetail a, sales.salesorderdetail b', 5_000)
    expect(cross.ok && cross.totalCost).toBeGreaterThan(1_000_000)
  })

  it('reports planning errors with their SQLSTATE', async () => {
    expect(await explainCost('SELECT no_such_column FROM sales.store', 5_000)).toMatchObject({
      ok: false,
      kind: 'error',
      sqlState: '42703',
    })
  })

  it('reports database permission refusals separately', async () => {
    // A lorint view schema: the reader role has no USAGE on it.
    expect(await explainCost('SELECT * FROM hr.e', 5_000)).toMatchObject({ ok: false, kind: 'permission_denied' })
  })

  it('cannot be turned into EXPLAIN ANALYZE through its input', async () => {
    // "EXPLAIN (FORMAT JSON) ANALYZE …" is not valid SQL, so nothing runs.
    expect(await explainCost('ANALYZE SELECT 1', 5_000)).toMatchObject({ ok: false, sqlState: '42601' })
  })
})

describe('EXPLAIN ANALYZE is never issued', () => {
  it('no statement sent to the reader database uses ANALYZE', async () => {
    // The spy records every query sent by pool clients and passes it through.
    const spy = vi.spyOn(Client.prototype, 'query')

    for (const testCase of loadSafeCases().slice(0, 20)) {
      expect(await validateSql(testCase.sql)).toMatchObject({ ok: true })
      await explainCost(testCase.sql, 5_000)
      await executeQuery(testCase.sql, { rowLimit: 5, timeoutMs: 5_000 })
    }

    const sent = spy.mock.calls.map(([config]: unknown[]) =>
      typeof config === 'string' ? config : isObject(config) && typeof config.text === 'string' ? config.text : '',
    )
    const explains = sent.filter((text) => /^\s*EXPLAIN\b/i.test(text))
    expect(explains.length).toBe(20)
    for (const text of explains) expect(text).toMatch(/^EXPLAIN \(FORMAT JSON\) /)
    expect(sent.filter((text) => /\bANALY[SZ]E\b/i.test(text))).toEqual([])
  })

  it('the only EXPLAIN in the server source is EXPLAIN (FORMAT JSON)', () => {
    const srcRoot = fileURLToPath(new URL('../../src', import.meta.url))
    const files = readdirSync(srcRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => join(entry.parentPath, entry.name))
    const code = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)),
    )
    expect(code.filter((line) => /explain\s*(\([^)]*)?analy[sz]e/i.test(line))).toEqual([])
    const uses = code.filter((line) => /\bEXPLAIN\b/.test(line))
    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) {
      expect(line).toMatch(/`EXPLAIN \(FORMAT JSON\) \$\{sql\}`/)
    }
  })
})
