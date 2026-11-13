import { afterAll, describe, expect, it } from 'vitest'
import { explainCost } from '../../src/safety/cost.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { applyRowLimit } from '../../src/safety/limit.js'
import { validateSql } from '../../src/safety/validate.js'
import { loadMaliciousCases, loadSafeCases } from '../helpers/sql-cases.js'

// M1 acceptance: every malicious case is rejected with its expected rule id; every
// safe case passes validation, the row-limit rewrite, re-validation and a real EXPLAIN
// against AdventureWorks (so the safe corpus is real, runnable SQL).

const malicious = loadMaliciousCases()
const safe = loadSafeCases()

afterAll(async () => {
  await closeReaderConnections()
})

describe('SQL corpora', () => {
  it('meet the minimum sizes (≥ 100 malicious, ≥ 50 safe) with unique ids', () => {
    expect(malicious.length).toBeGreaterThanOrEqual(100)
    expect(safe.length).toBeGreaterThanOrEqual(50)
    const ids = [...malicious, ...safe].map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('malicious SQL is rejected with the expected rule', () => {
  it.each(malicious.map((c) => [c.id, c] as const))('%s', async (_id, testCase) => {
    const result = await validateSql(testCase.sql)
    expect(result).toMatchObject({ ok: false, rule: testCase.rule })
    if (!result.ok) {
      expect(result.retryable).toBe(testCase.rule === 'PARSE_ERROR')
    }
  })
})

describe('safe SQL passes validation, rewrite and EXPLAIN', () => {
  it.each(safe.map((c) => [c.id, c] as const))('%s', async (_id, testCase) => {
    const validation = await validateSql(testCase.sql)
    expect(validation).toMatchObject({ ok: true })
    if (!validation.ok) return

    const limited = await applyRowLimit(testCase.sql, validation.statement, 500)
    expect(limited).toMatchObject({ ok: true })
    if (!limited.ok) return
    expect(await validateSql(limited.sql)).toMatchObject({ ok: true })

    const cost = await explainCost(limited.sql, 5_000)
    expect(cost).toMatchObject({ ok: true })
  })
})
