import { and, eq, inArray, sql } from 'drizzle-orm'
import { getEnv } from '../config/env.js'
import { getAppDb } from '../db/app.js'
import { dailyUsage } from '../db/schema.js'
import { microUsdToNumeric } from '../lib/cost.js'
import { AppError } from '../lib/errors.js'
import type { RequestSource } from './audit.service.js'

// Usage accounting and the daily token budget (IMPLEMENTATION.md 17, D15, D25).
//
// - The budget counts LLM tokens of the app and MCP only; embedding tokens are
//   recorded but not counted, and evaluation runs are not capped here.
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

/** LLM tokens used today by the budgeted sources (app + MCP). */
export async function budgetedTokensToday(): Promise<number> {
  const rows = await getAppDb()
    .select({ used: sql<string>`coalesce(sum(${dailyUsage.llmTokens}), 0)` })
    .from(dailyUsage)
    .where(and(eq(dailyUsage.day, UTC_TODAY), inArray(dailyUsage.source, [...BUDGETED_SOURCES])))
  return Number(rows[0]?.used ?? 0)
}

/**
 * Throws BUDGET_EXCEEDED when the source is budgeted and today's LLM tokens have
 * reached DAILY_TOKEN_BUDGET. Called before every LLM and embedding call.
 */
export async function assertWithinBudget(source: RequestSource): Promise<void> {
  if (!(BUDGETED_SOURCES as readonly RequestSource[]).includes(source)) {
    return
  }
  const limit = getEnv().DAILY_TOKEN_BUDGET
  const used = await budgetedTokensToday()
  if (used >= limit) {
    throw new AppError('BUDGET_EXCEEDED', 'The daily usage limit has been reached. Please try again tomorrow.')
  }
}
