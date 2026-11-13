import { getEnv } from '../config/env.js'
import { classifyCost, explainCost } from '../safety/cost.js'
import { executeQuery, type DbFailure, type ResultColumn } from '../safety/executor.js'
import { applyRowLimit } from '../safety/limit.js'
import { maskRows } from '../safety/mask.js'
import type { PolicyRule } from '../safety/policy.js'
import { validateSql } from '../safety/validate.js'
import { recordAuditEvent, type RequestSource } from './audit.service.js'

// The one safety pipeline (IMPLEMENTATION.md 9.3 rule 2, section 13):
// validate → row limit → cost check → execute → mask. Every SQL from the agent,
// MCP, examples or evaluation runs through runSafeQuery, and each validation, cost
// and execution decision writes exactly one audit row.

export type SafetyRule =
  | PolicyRule
  | 'POLICY_OK'
  | 'COST_OK'
  | 'COST_SOFT_LIMIT'
  | 'COST_HARD_LIMIT'
  | 'COST_APPROVED'
  | 'PLAN_ERROR'
  | 'PERMISSION_DENIED'
  | 'EXECUTED'
  | 'QUERY_TIMEOUT'
  | 'EXECUTION_ERROR'

/**
 * What happens above the soft cost limit (12.3): the app asks for approval, MCP
 * blocks, evaluation and an approved resume continue (recorded as COST_APPROVED).
 */
export type SoftLimitPolicy = 'require_approval' | 'block' | 'allow'

export interface SafeQueryInput {
  sql: string
  source: RequestSource
  softLimit: SoftLimitPolicy
  questionId?: string | undefined
}

export type BlockedStage = 'validation' | 'cost' | 'execution'

export type SafeQueryResult =
  | {
      status: 'executed'
      sql: string
      cost: number
      columns: ResultColumn[]
      rows: unknown[][]
      rowCount: number
      truncated: boolean
    }
  | { status: 'needs_approval'; sql: string; cost: number; softLimit: number }
  | {
      status: 'blocked'
      stage: BlockedStage
      rule: SafetyRule
      message: string
      /** True when a revised query may succeed (parse, planning and SQL errors). */
      retryable: boolean
      /** Postgres error for the agent's self-correction; never sent to clients as is. */
      dbError?: { sqlState: string; message: string }
    }

type Blocked = Extract<SafeQueryResult, { status: 'blocked' }>

const failureRules = {
  cost: { timeout: 'QUERY_TIMEOUT', permission_denied: 'PERMISSION_DENIED', error: 'PLAN_ERROR' },
  execution: { timeout: 'QUERY_TIMEOUT', permission_denied: 'PERMISSION_DENIED', error: 'EXECUTION_ERROR' },
} as const satisfies Record<'cost' | 'execution', Record<DbFailure['kind'], SafetyRule>>

const failureMessages: Record<DbFailure['kind'], string> = {
  timeout: 'The query took longer than the time limit',
  permission_denied: 'The database refused access',
  error: 'The database rejected the query',
}

export async function runSafeQuery(input: SafeQueryInput): Promise<SafeQueryResult> {
  const env = getEnv()
  const base = { source: input.source, questionId: input.questionId }

  const block = async (
    stage: BlockedStage,
    rule: SafetyRule,
    message: string,
    sql: string,
    extra: { retryable?: boolean; detail?: Record<string, unknown>; failure?: DbFailure } = {},
  ): Promise<Blocked> => {
    const failure = extra.failure
    const detail = failure === undefined ? extra.detail : { ...extra.detail, sqlState: failure.sqlState, dbMessage: failure.dbMessage }
    await recordAuditEvent({ ...base, stage, decision: 'blocked', rule, message, sql, detail })
    const result: Blocked = { status: 'blocked', stage, rule, message, retryable: extra.retryable ?? false }
    if (failure !== undefined) result.dbError = { sqlState: failure.sqlState, message: failure.dbMessage }
    return result
  }

  // Layer 2: parse and policy, then the row limit; the rewritten SQL must pass again.
  const validation = await validateSql(input.sql)
  if (!validation.ok) {
    return block('validation', validation.rule, validation.message, input.sql, { retryable: validation.retryable })
  }
  const limited = await applyRowLimit(input.sql, validation.statement, env.QUERY_ROW_LIMIT)
  if (!limited.ok) {
    return block('validation', 'NOT_SELECT', limited.message, input.sql)
  }
  const revalidation = await validateSql(limited.sql)
  if (!revalidation.ok) {
    return block('validation', revalidation.rule, `Rewritten query: ${revalidation.message}`, input.sql)
  }
  const sql = limited.sql
  await recordAuditEvent({
    ...base,
    stage: 'validation',
    decision: 'allowed',
    rule: 'POLICY_OK',
    message: 'Query passed the safety policy',
    sql: input.sql,
    detail: { executedSql: sql },
  })

  // Layer 3: cost check.
  const costCheck = await explainCost(sql, env.QUERY_TIMEOUT_MS)
  if (!costCheck.ok) {
    return block('cost', failureRules.cost[costCheck.kind], failureMessages[costCheck.kind], sql, {
      retryable: costCheck.kind === 'error',
      failure: costCheck,
    })
  }
  const cost = costCheck.totalCost
  const limits = { soft: env.QUERY_COST_SOFT_LIMIT, hard: env.QUERY_COST_HARD_LIMIT }
  const costDetail = { cost, softLimit: limits.soft, hardLimit: limits.hard }
  const level = classifyCost(cost, limits)
  if (level === 'over_hard') {
    return block('cost', 'COST_HARD_LIMIT', 'Estimated query cost is above the hard limit', sql, { detail: costDetail })
  }
  if (level === 'over_soft' && input.softLimit === 'block') {
    return block('cost', 'COST_SOFT_LIMIT', 'Estimated query cost is above the soft limit', sql, { detail: costDetail })
  }
  if (level === 'over_soft' && input.softLimit === 'require_approval') {
    await recordAuditEvent({
      ...base,
      stage: 'cost',
      decision: 'needs_approval',
      rule: 'COST_SOFT_LIMIT',
      message: 'Estimated query cost is above the soft limit; approval required',
      sql,
      detail: costDetail,
    })
    return { status: 'needs_approval', sql, cost, softLimit: limits.soft }
  }
  await recordAuditEvent({
    ...base,
    stage: 'cost',
    decision: 'allowed',
    rule: level === 'ok' ? 'COST_OK' : 'COST_APPROVED',
    message: level === 'ok' ? 'Estimated cost is within limits' : 'Estimated cost is above the soft limit; approved',
    sql,
    detail: costDetail,
  })

  // Layer 4: execute; layer 5: mask.
  const execution = await executeQuery(sql, { rowLimit: env.QUERY_ROW_LIMIT, timeoutMs: env.QUERY_TIMEOUT_MS })
  if (!execution.ok) {
    return block('execution', failureRules.execution[execution.kind], failureMessages[execution.kind], sql, {
      retryable: execution.kind === 'error',
      failure: execution,
    })
  }
  await recordAuditEvent({
    ...base,
    stage: 'execution',
    decision: 'allowed',
    rule: 'EXECUTED',
    message: `Returned ${execution.rowCount} row(s)`,
    sql,
    detail: { rowCount: execution.rowCount, truncated: execution.truncated, durationMs: execution.durationMs },
  })
  return {
    status: 'executed',
    sql,
    cost,
    columns: execution.columns,
    rows: maskRows(execution.columns, execution.rows),
    rowCount: execution.rowCount,
    truncated: execution.truncated,
  }
}
