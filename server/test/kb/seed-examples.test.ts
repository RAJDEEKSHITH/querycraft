import { afterAll, describe, expect, it, vi } from 'vitest'
import { closeAppPool } from '../../src/db/app.js'
import { examplesFileSchema, readSeedFile, seedPath } from '../../src/kb/seed-files.js'
import { normalizeQuestion } from '../../src/retrieval/leakage.js'
import { closeReaderConnections } from '../../src/safety/executor.js'
import { runSafeQuery } from '../../src/services/safe-query.service.js'

// Every seed example goes through validate → limit → cost → execute
// (IMPLEMENTATION.md 9.3 rule 2) and must run within the soft cost limit and
// return rows. Limits are the .env.example values, independent of the local .env.
vi.stubEnv('QUERY_COST_SOFT_LIMIT', '50000')
vi.stubEnv('QUERY_COST_HARD_LIMIT', '500000')
vi.stubEnv('QUERY_ROW_LIMIT', '500')

const examples = await readSeedFile(seedPath.examples, examplesFileSchema)

afterAll(async () => {
  await closeReaderConnections()
  await closeAppPool()
})

describe('seed/examples.json', () => {
  it('has about 30 examples with distinct questions', () => {
    expect(examples.length).toBeGreaterThanOrEqual(25)
    const normalized = examples.map((e) => normalizeQuestion(e.question))
    expect(new Set(normalized).size).toBe(examples.length)
  })

  it.each(examples.map((e) => [e.question, e.sql] as const))('runs safely: %s', async (_question, sql) => {
    const result = await runSafeQuery({ sql, source: 'app', softLimit: 'require_approval' })
    if (result.status !== 'executed') {
      throw new Error(`not executed: ${JSON.stringify(result)}`)
    }
    expect(result.rowCount).toBeGreaterThan(0)
  })
})
