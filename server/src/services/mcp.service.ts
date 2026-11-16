import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getAppDb } from '../db/app.js'
import { auditEvents, type StoredColumn } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import { DENIED_TABLES } from '../safety/policy.js'
import { findTable, listTables } from './knowledge.service.js'
import { createQuestion, runQuestion, type QuestionDeps } from './question.service.js'
import { runSafeQuery } from './safe-query.service.js'
import { assertWithinBudget } from './usage.service.js'

// The four MCP tools (IMPLEMENTATION.md 16) over the existing services: the
// knowledge base, the one safety pipeline and the question runner. Everything
// runs with `source = mcp`; above the soft cost limit MCP is blocked, never asked.

/** Rows returned to an MCP client per call (16). */
export const MCP_MAX_ROWS = 100

export interface McpTable {
  schema: string
  table: string
  description: string
}

export interface McpColumn {
  name: string
  type: string
  nullable: boolean
  /** Masked in results (email / phone). */
  pii: 'email' | 'phone' | null
  /** `schema.table.column` of a foreign key, or null. */
  references: string | null
}

export interface McpTableDetail extends McpTable {
  columns: McpColumn[]
}

export interface McpRows {
  columns: StoredColumn[]
  /** At most MCP_MAX_ROWS masked rows. */
  rows: unknown[][]
  /** Rows the query returned (at most the server row limit). */
  rowCount: number
  /** True when more rows exist than `rows` holds. */
  truncated: boolean
}

export interface McpBlocked {
  status: 'blocked'
  stage: string
  rule: string
  message: string
}

export type McpQueryResult = ({ status: 'executed'; sql: string; cost: number } & McpRows) | McpBlocked

export type McpAnswer =
  | ({
      status: 'answered'
      questionId: string
      answer: string
      explanation: string
      sql: string
      tablesUsed: string[]
      assumptions: string[]
    } & McpRows)
  | { status: 'clarification_needed'; questionId: string; question: string; options: string[] }
  | { status: 'approval_required'; questionId: string; estimatedCost: number | null; softLimit: number | null; message: string }
  | { status: 'cannot_answer'; questionId: string; reason: string }
  | (McpBlocked & { questionId: string })
  | { status: 'failed'; questionId: string; code: string; message: string }

function isDeniedTable(schema: string, table: string): boolean {
  return DENIED_TABLES.some((t) => t.schema === schema && t.table === table)
}

function limitRows(columns: readonly StoredColumn[], rows: readonly unknown[][], rowCount: number, truncated: boolean): McpRows {
  return {
    columns: columns.map((c) => ({ name: c.name, type: c.type })),
    rows: rows.slice(0, MCP_MAX_ROWS),
    rowCount,
    truncated: truncated || rows.length > MCP_MAX_ROWS,
  }
}

export async function listMcpTables(): Promise<McpTable[]> {
  const tables = await listTables()
  return tables
    .filter((t) => !isDeniedTable(t.schema, t.table))
    .map((t) => ({ schema: t.schema, table: t.table, description: t.description }))
}

/** Columns and types; denied columns are left out and PII columns flagged. */
export async function describeMcpTable(schema: string, table: string): Promise<McpTableDetail> {
  const found = isDeniedTable(schema, table) ? null : await findTable(schema, table)
  if (found === null) throw new AppError('NOT_FOUND', `Table ${schema}.${table} is not available`)
  return {
    schema: found.schema,
    table: found.table,
    description: found.description,
    columns: found.columns
      .filter((c) => !c.denied)
      .map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        pii: c.pii,
        references: c.fk === null ? null : `${c.fk.schema}.${c.fk.table}.${c.fk.column}`,
      })),
  }
}

/** The full safety pipeline; the soft cost limit is treated as hard. */
export async function runMcpQuery(sql: string): Promise<McpQueryResult> {
  const result = await runSafeQuery({ sql, source: 'mcp', softLimit: 'block' })
  if (result.status === 'executed') {
    return { status: 'executed', sql: result.sql, cost: result.cost, ...limitRows(result.columns, result.rows, result.rowCount, result.truncated) }
  }
  if (result.status === 'blocked') {
    return { status: 'blocked', stage: result.stage, rule: result.rule, message: result.message }
  }
  // Unreachable: the `block` policy never asks for approval.
  throw new AppError('INTERNAL_ERROR', 'Internal server error', { cause: new Error('MCP query asked for approval') })
}

const costDetail = z.object({ cost: z.number(), softLimit: z.number() })

/** The cost estimate recorded when the soft limit blocked this question's query. */
async function softLimitEstimate(questionId: string): Promise<{ estimatedCost: number; softLimit: number } | null> {
  const [row] = await getAppDb()
    .select({ detail: auditEvents.detail })
    .from(auditEvents)
    .where(and(eq(auditEvents.questionId, questionId), eq(auditEvents.stage, 'cost'), eq(auditEvents.rule, 'COST_SOFT_LIMIT')))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1)
  const parsed = costDetail.safeParse(row?.detail)
  return parsed.success ? { estimatedCost: parsed.data.cost, softLimit: parsed.data.softLimit } : null
}

const APPROVAL_MESSAGE =
  'The query is estimated to be too expensive to run without approval, and MCP cannot approve it. Ask a narrower question or use the QueryCraft web app.'

/** Runs one question through the agent with `source = mcp` (no resume: a clarification is returned as text). */
export async function askMcpQuestion(question: string, deps: QuestionDeps): Promise<McpAnswer> {
  await assertWithinBudget('mcp')
  const { questionId } = await createQuestion({ question })
  const outcome = await runQuestion(questionId, { source: 'mcp' }, deps)
  switch (outcome.status) {
    case 'answered':
      return {
        status: 'answered',
        questionId,
        answer: outcome.answer,
        explanation: outcome.explanation,
        sql: outcome.sql,
        tablesUsed: outcome.tablesUsed,
        assumptions: outcome.assumptions,
        ...limitRows(outcome.columns, outcome.rows, outcome.rowCount, outcome.truncated),
      }
    case 'awaiting_clarification':
      return { status: 'clarification_needed', questionId, ...outcome.clarification }
    case 'awaiting_approval':
      return {
        status: 'approval_required',
        questionId,
        estimatedCost: outcome.approval.estimatedCost,
        softLimit: outcome.approval.softLimit,
        message: APPROVAL_MESSAGE,
      }
    case 'blocked': {
      if (outcome.rule === 'COST_SOFT_LIMIT') {
        const estimate = await softLimitEstimate(questionId)
        return {
          status: 'approval_required',
          questionId,
          estimatedCost: estimate?.estimatedCost ?? null,
          softLimit: estimate?.softLimit ?? null,
          message: APPROVAL_MESSAGE,
        }
      }
      return { status: 'blocked', questionId, stage: outcome.stage, rule: outcome.rule, message: outcome.message }
    }
    case 'cannot_answer':
      return { status: 'cannot_answer', questionId, reason: outcome.reason }
    case 'cancelled':
      return { status: 'failed', questionId, code: 'CANCELLED', message: 'The question was cancelled.' }
    case 'failed':
      return { status: 'failed', questionId, code: outcome.errorCode, message: outcome.message }
  }
}
