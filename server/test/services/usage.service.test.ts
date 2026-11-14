import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAppPool, getAppPool } from '../../src/db/app.js'
import { AppError } from '../../src/lib/errors.js'
import { assertWithinBudget, budgetedTokensToday, evalTokensToday, recordUsage } from '../../src/services/usage.service.js'

vi.stubEnv('DAILY_TOKEN_BUDGET', '1000')
vi.stubEnv('EVAL_DAILY_TOKEN_BUDGET', '500')

interface UsageRow {
  source: string
  llm_tokens: number
  embedding_tokens: number
  llm_requests: number
  embedding_requests: number
  cost_usd: string
  is_today: boolean
}

async function rows(): Promise<UsageRow[]> {
  const result = await getAppPool().query<UsageRow>(
    `SELECT source, llm_tokens, embedding_tokens, llm_requests, embedding_requests, cost_usd,
            day = (now() AT TIME ZONE 'UTC')::date AS is_today
       FROM daily_usage ORDER BY source`,
  )
  return result.rows
}

async function expectBudgetExceeded(promise: Promise<unknown>): Promise<void> {
  const err: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(AppError)
  expect(err instanceof AppError ? err.code : undefined).toBe('BUDGET_EXCEEDED')
}

beforeEach(async () => {
  await getAppPool().query('TRUNCATE daily_usage')
})

afterAll(async () => {
  await closeAppPool()
})

describe('recordUsage', () => {
  it('creates today\'s row (UTC) for the source', async () => {
    await recordUsage({ source: 'app', llmTokens: 120, llmRequests: 1, costMicroUsd: 150_600 })
    expect(await rows()).toEqual([
      {
        source: 'app',
        llm_tokens: 120,
        embedding_tokens: 0,
        llm_requests: 1,
        embedding_requests: 0,
        cost_usd: '0.150600',
        is_today: true,
      },
    ])
  })

  it('adds atomically under concurrent calls', async () => {
    await Promise.all(
      Array.from({ length: 25 }, () =>
        recordUsage({ source: 'mcp', llmTokens: 10, embeddingTokens: 3, llmRequests: 1, embeddingRequests: 1, costMicroUsd: 7 }),
      ),
    )
    const [row] = await rows()
    expect(row).toMatchObject({
      source: 'mcp',
      llm_tokens: 250,
      embedding_tokens: 75,
      llm_requests: 25,
      embedding_requests: 25,
      cost_usd: '0.000175',
    })
  })

  it('keeps one row per source', async () => {
    await recordUsage({ source: 'app', llmTokens: 1 })
    await recordUsage({ source: 'eval', llmTokens: 2 })
    await recordUsage({ source: 'app', llmTokens: 3 })
    expect((await rows()).map((r) => [r.source, r.llm_tokens])).toEqual([
      ['app', 4],
      ['eval', 2],
    ])
  })

  it('rejects negative or fractional counts', async () => {
    await expect(recordUsage({ source: 'app', llmTokens: -1 })).rejects.toThrow(RangeError)
    await expect(recordUsage({ source: 'app', embeddingTokens: 0.5 })).rejects.toThrow(RangeError)
    expect(await rows()).toEqual([])
  })
})

describe('token budget guard', () => {
  it('allows calls below the cap and blocks at the cap', async () => {
    await recordUsage({ source: 'app', llmTokens: 999 })
    await expect(assertWithinBudget('app')).resolves.toBeUndefined()
    await recordUsage({ source: 'mcp', llmTokens: 1 })
    expect(await budgetedTokensToday()).toBe(1000)
    await expectBudgetExceeded(assertWithinBudget('app'))
    await expectBudgetExceeded(assertWithinBudget('mcp'))
  })

  it('counts app and MCP together', async () => {
    await recordUsage({ source: 'app', llmTokens: 600 })
    await recordUsage({ source: 'mcp', llmTokens: 600 })
    await expectBudgetExceeded(assertWithinBudget('mcp'))
  })

  it('does not count embedding tokens', async () => {
    await recordUsage({ source: 'app', embeddingTokens: 50_000 })
    await expect(assertWithinBudget('app')).resolves.toBeUndefined()
  })

  it('caps evaluation runs separately with EVAL_DAILY_TOKEN_BUDGET', async () => {
    await recordUsage({ source: 'eval', llmTokens: 499 })
    await expect(assertWithinBudget('eval')).resolves.toBeUndefined()
    await recordUsage({ source: 'eval', llmTokens: 1 })
    expect(await evalTokensToday()).toBe(500)
    await expectBudgetExceeded(assertWithinBudget('eval'))
  })

  it('keeps the app + MCP and evaluation budgets apart', async () => {
    await recordUsage({ source: 'eval', llmTokens: 50_000 })
    await expect(assertWithinBudget('app')).resolves.toBeUndefined()
    expect(await budgetedTokensToday()).toBe(0)
    await getAppPool().query('TRUNCATE daily_usage')
    await recordUsage({ source: 'app', llmTokens: 1000 })
    await recordUsage({ source: 'mcp', llmTokens: 1000 })
    await expect(assertWithinBudget('eval')).resolves.toBeUndefined()
    expect(await evalTokensToday()).toBe(0)
  })

  it('reports the evaluation cap with its own safe message', async () => {
    await recordUsage({ source: 'eval', llmTokens: 500 })
    const err: unknown = await assertWithinBudget('eval').catch((e: unknown) => e)
    expect(err instanceof AppError ? err.message : '').toBe('The daily evaluation token budget has been reached.')
  })

  it('ignores earlier days', async () => {
    await getAppPool().query(
      `INSERT INTO daily_usage (day, source, llm_tokens) VALUES ((now() AT TIME ZONE 'UTC')::date - 1, 'app', 5000)`,
    )
    expect(await budgetedTokensToday()).toBe(0)
    await expect(assertWithinBudget('app')).resolves.toBeUndefined()
  })

  it('reports a safe message without numbers or internals', async () => {
    await recordUsage({ source: 'app', llmTokens: 1000 })
    const err: unknown = await assertWithinBudget('app').catch((e: unknown) => e)
    expect(err instanceof AppError ? err.message : '').toBe(
      'The daily usage limit has been reached. Please try again tomorrow.',
    )
  })
})
