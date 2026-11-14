import { and, eq, inArray, sql } from 'drizzle-orm'
import { getEnv } from '../config/env.js'
import { getAppDb } from '../db/app.js'
import { dailyUsage } from '../db/schema.js'
import { microUsdToNumeric } from '../lib/cost.js'
import { AppError } from '../lib/errors.js'
import type { RequestSource } from './audit.service.js'

// Usage accounting and the daily token budget (IMPLEMENTATION.md 17, D15, D25).
//
// - DAILY_TOKEN_BUDGET counts LLM tokens of the app and MCP; evaluation runs have
//   their own EVAL_DAILY_TOKEN_BUDGET over source `eval` (M4 decision). Embedding
//   tokens are recorded but never counted.
// - Check before a call, atomic add after it (D15): concurrent calls may overshoot
//   by one call each.
// - A budget day is the UTC date, computed by the database in both places.

const UTC_TODAY = sql`(now() AT TIME ZONE 'UTC')::date`

/** Sources whose LLM tokens count against DAILY_TOKEN_BUDGET. */
const BUDGETED_SOURCES = ['app', 'mcp'] as const satisfies readonly RequestSource[]

export interface UsageIncrement {
  source: RequestSource
  llmTokens?: number
  embeddingTokens?: number
  llmRequests?: number
  embeddingRequests?: number
  costMicroUsd?: number
}

function count(value: number | undefined): number {
  const n = value ?? 0
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError('Usage counts must be non-negative integers')
  }
  return n
}

/** Adds to today's usage row for the source in one atomic upsert. */
export async function recordUsage(increment: UsageIncrement): Promise<void> {
  const llmTokens = count(increment.llmTokens)
  const embeddingTokens = count(increment.embeddingTokens)
  const llmRequests = count(increment.llmRequests)
  const embeddingRequests = count(increment.embeddingRequests)
  const costUsd = microUsdToNumeric(count(increment.costMicroUsd))

  await getAppDb()
    .insert(dailyUsage)
    .values({
      day: sql`${UTC_TODAY}`,
      source: increment.source,
      llmTokens,
      embeddingTokens,
      llmRequests,
      embeddingRequests,
      costUsd,
    })
    .onConflictDoUpdate({
      target: [dailyUsage.day, dailyUsage.source],
      set: {
        llmTokens: sql`${dailyUsage.llmTokens} + excluded.llm_tokens`,
        embeddingTokens: sql`${dailyUsage.embeddingTokens} + excluded.embedding_tokens`,
        llmRequests: sql`${dailyUsage.llmRequests} + excluded.llm_requests`,
        embeddingRequests: sql`${dailyUsage.embeddingRequests} + excluded.embedding_requests`,
        costUsd: sql`${dailyUsage.costUsd} + excluded.cost_usd`,
        updatedAt: sql`now()`,
      },
    })
}

async function llmTokensToday(sources: readonly RequestSource[]): Promise<number> {
  const rows = await getAppDb()
    .select({ used: sql<string>`coalesce(sum(${dailyUsage.llmTokens}), 0)` })
    .from(dailyUsage)
    .where(and(eq(dailyUsage.day, UTC_TODAY), inArray(dailyUsage.source, [...sources])))
  return Number(rows[0]?.used ?? 0)
}

/** LLM tokens used today by the budgeted sources (app + MCP). */
export async function budgetedTokensToday(): Promise<number> {
  return llmTokensToday(BUDGETED_SOURCES)
}

/** LLM tokens used today by evaluation runs. */
export async function evalTokensToday(): Promise<number> {
  return llmTokensToday(['eval'])
}

/**
 * Throws BUDGET_EXCEEDED when today's LLM tokens have reached the source's cap:
 * DAILY_TOKEN_BUDGET for app + MCP together, EVAL_DAILY_TOKEN_BUDGET for eval.
 * Called before every LLM and embedding call.
 */
export async function assertWithinBudget(source: RequestSource): Promise<void> {
  const env = getEnv()
  if (source === 'eval') {
    if ((await evalTokensToday()) >= env.EVAL_DAILY_TOKEN_BUDGET) {
      throw new AppError('BUDGET_EXCEEDED', 'The daily evaluation token budget has been reached.')
    }
    return
  }
  if ((await budgetedTokensToday()) >= env.DAILY_TOKEN_BUDGET) {
    throw new AppError('BUDGET_EXCEEDED', 'The daily usage limit has been reached. Please try again tomorrow.')
  }
}
