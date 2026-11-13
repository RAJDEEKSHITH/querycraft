import { getEnv } from '../config/env.js'
import { classifyCost, explainCost } from '../safety/cost.js'
import { executeQuery, type DbFailure, type ResultColumn } from '../safety/executor.js'
import { applyRowLimit } from '../safety/limit.js'
import { maskRows } from '../safety/mask.js'
import type { PolicyRule } from '../safety/policy.js'
import { validateSql } from '../safety/validate.js'
import { recordAuditEvent, type RequestSource } from './audit.service.js'

// The one safety pipeline (IMPLEMENTATION.md 9.3 rule 2, section 13):
// validate → row limit → cost check → execute → mask. Each validation, cost and
// execution decision writes exactly one audit row.
//
// The stages are exported for the agent graph, whose validate_sql, cost_check and
// execute nodes run them one by one (the approval interrupt sits between cost and
// execute). runSafeQuery runs all three for MCP, examples and evaluation. The
// execute stage only runs SQL that already carries the row limit and passes the
// policy again, so it cannot be used to skip validation.

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
  | 'APPROVAL_DENIED'

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

export type Blocked = {
  status: 'blocked'
  stage: BlockedStage
  rule: SafetyRule
  message: string
  /** True when a revised query may succeed (parse, planning and SQL errors). */
  retryable: boolean
  /** Postgres error for the agent's self-correction; never sent to clients as is. */
  dbError?: { sqlState: string; message: string }
}

export interface Executed {
  status: 'executed'
  sql: string
  columns: ResultColumn[]
  /** Masked rows (layer 5). */
  rows: unknown[][]
  rowCount: number
  truncated: boolean
}

export interface NeedsApproval {
  status: 'needs_approval'
  sql: string
  cost: number
  softLimit: number
}

export type SafeQueryResult = (Executed & { cost: number }) | NeedsApproval | Blocked

/** Policy stage result: `sql` is the checked query with the row limit applied. */
export type PolicyResult = { status: 'ok'; sql: string } | Blocked

export type CostResult = { status: 'ok'; sql: string; cost: number } | NeedsApproval | Blocked

export type ExecuteResult = Executed | Blocked

interface StageContext {
  source: RequestSource
  questionId?: string | undefined
}

const failureRules = {
  cost: { timeout: 'QUERY_TIMEOUT', permission_denied: 'PERMISSION_DENIED', error: 'PLAN_ERROR' },
  execution: { timeout: 'QUERY_TIMEOUT', permission_denied: 'PERMISSION_DENIED', error: 'EXECUTION_ERROR' },
} as const satisfies Record<'cost' | 'execution', Record<DbFailure['kind'], SafetyRule>>

const failureMessages: Record<DbFailure['kind'], string> = {
  timeout: 'The query took longer than the time limit',
  permission_denied: 'The database refused access',
  error: 'The database rejected the query',
}

async function block(
  context: StageContext,
  stage: BlockedStage,
  rule: SafetyRule,
  message: string,
  sql: string,
  extra: { retryable?: boolean; detail?: Record<string, unknown>; failure?: DbFailure } = {},
): Promise<Blocked> {
  const failure = extra.failure
  const detail = failure === undefined ? extra.detail : { ...extra.detail, sqlState: failure.sqlState, dbMessage: failure.dbMessage }
  await recordAuditEvent({ source: context.source, questionId: context.questionId, stage, decision: 'blocked', rule, message, sql, detail })
  const result: Blocked = { status: 'blocked', stage, rule, message, retryable: extra.retryable ?? false }
  if (failure !== undefined) result.dbError = { sqlState: failure.sqlState, message: failure.dbMessage }
  return result
}

/** The query with the row limit applied, if it passes the policy before and after. */
async function limitedQuery(
  sql: string,
  rowLimit: number,
): Promise<{ ok: true; sql: string } | { ok: false; rule: PolicyRule; message: string; retryable: boolean }> {
  const validation = await validateSql(sql)
  if (!validation.ok) {
    return { ok: false, rule: validation.rule, message: validation.message, retryable: validation.retryable }
  }
  const limited = await applyRowLimit(sql, validation.statement, rowLimit)
  if (!limited.ok) {
    return { ok: false, rule: 'NOT_SELECT', message: limited.message, retryable: false }
  }
  const revalidation = await validateSql(limited.sql)
  if (!revalidation.ok) {
    return { ok: false, rule: revalidation.rule, message: `Rewritten query: ${revalidation.message}`, retryable: false }
  }
  return { ok: true, sql: limited.sql }
}

/** Layer 2: parse and policy, then the row limit; the rewritten SQL must pass again. */
export async function checkPolicy(sql: string, context: StageContext): Promise<PolicyResult> {
  const env = getEnv()
  const checked = await limitedQuery(sql, env.QUERY_ROW_LIMIT)
  if (!checked.ok) {
    return block(context, 'validation', checked.rule, checked.message, sql, { retryable: checked.retryable })
  }
  await recordAuditEvent({
    ...context,
    stage: 'validation',
    decision: 'allowed',
    rule: 'POLICY_OK',
    message: 'Query passed the safety policy',
    sql,
    detail: { executedSql: checked.sql },
  })
  return { status: 'ok', sql: checked.sql }
}

/** Layer 3: `EXPLAIN (FORMAT JSON)` cost against the soft and hard limits. `sql` comes from checkPolicy. */
export async function checkCost(sql: string, softLimit: SoftLimitPolicy, context: StageContext): Promise<CostResult> {
  const env = getEnv()
  const costCheck = await explainCost(sql, env.QUERY_TIMEOUT_MS)
  if (!costCheck.ok) {
    return block(context, 'cost', failureRules.cost[costCheck.kind], failureMessages[costCheck.kind], sql, {
      retryable: costCheck.kind === 'error',
      failure: costCheck,
    })
  }
  const cost = costCheck.totalCost
  const limits = { soft: env.QUERY_COST_SOFT_LIMIT, hard: env.QUERY_COST_HARD_LIMIT }
  const costDetail = { cost, softLimit: limits.soft, hardLimit: limits.hard }
  const level = classifyCost(cost, limits)
  if (level === 'over_hard') {
    return block(context, 'cost', 'COST_HARD_LIMIT', 'Estimated query cost is above the hard limit', sql, { detail: costDetail })
  }
  if (level === 'over_soft' && softLimit === 'block') {
    return block(context, 'cost', 'COST_SOFT_LIMIT', 'Estimated query cost is above the soft limit', sql, { detail: costDetail })
  }
  if (level === 'over_soft' && softLimit === 'require_approval') {
    await recordAuditEvent({
      ...context,
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
    ...context,
    stage: 'cost',
    decision: 'allowed',
    rule: level === 'ok' ? 'COST_OK' : 'COST_APPROVED',
    message: level === 'ok' ? 'Estimated cost is within limits' : 'Estimated cost is above the soft limit; approved',
    sql,
    detail: costDetail,
  })
  return { status: 'ok', sql, cost }
}

/** The user's answer to an approval request (audit row for the cost decision). */
export async function recordApproval(sql: string, approved: boolean, cost: number, context: StageContext): Promise<void> {
  await recordAuditEvent({
    ...context,
    stage: 'cost',
    decision: approved ? 'allowed' : 'blocked',
    rule: approved ? 'COST_APPROVED' : 'APPROVAL_DENIED',
    message: approved ? 'Estimated cost is above the soft limit; approved by the user' : 'The user denied the expensive query',
    sql,
    detail: { cost },
  })
}

/**
 * Layers 4 and 5: execute and mask. Runs only SQL that passes the policy again and
 * already carries the row limit (the output of checkPolicy); anything else is
 * blocked as NOT_SELECT without touching the database.
 */
export async function executeChecked(sql: string, context: StageContext): Promise<ExecuteResult> {
  const env = getEnv()
  const checked = await limitedQuery(sql, env.QUERY_ROW_LIMIT)
  if (!checked.ok || checked.sql !== sql) {
    return block(context, 'validation', 'NOT_SELECT', 'Query was not checked by the safety policy before execution', sql)
  }
  const execution = await executeQuery(sql, { rowLimit: env.QUERY_ROW_LIMIT, timeoutMs: env.QUERY_TIMEOUT_MS })
  if (!execution.ok) {
    return block(context, 'execution', failureRules.execution[execution.kind], failureMessages[execution.kind], sql, {
      retryable: execution.kind === 'error',
      failure: execution,
    })
  }
  await recordAuditEvent({
    ...context,
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
    columns: execution.columns,
    rows: maskRows(execution.columns, execution.rows),
    rowCount: execution.rowCount,
    truncated: execution.truncated,
  }
}

export async function runSafeQuery(input: SafeQueryInput): Promise<SafeQueryResult> {
  const context = { source: input.source, questionId: input.questionId }
  const policy = await checkPolicy(input.sql, context)
  if (policy.status !== 'ok') return policy
  const cost = await checkCost(policy.sql, input.softLimit, context)
  if (cost.status !== 'ok') return cost
  const execution = await executeChecked(cost.sql, context)
  return execution.status === 'executed' ? { ...execution, cost: cost.cost } : execution
}
