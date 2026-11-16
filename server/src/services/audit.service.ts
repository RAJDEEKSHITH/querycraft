import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { auditDecision, auditEvents, auditStage, requestSource } from '../db/schema.js'
import { AppError } from '../lib/errors.js'

// Audit log of safety decisions (IMPLEMENTATION.md 13.5, F11). Failures to write
// are not swallowed: a decision that cannot be audited must not go unrecorded.

export type RequestSource = (typeof requestSource.enumValues)[number]
export type AuditStage = (typeof auditStage.enumValues)[number]
export type AuditDecision = (typeof auditDecision.enumValues)[number]

export interface AuditEventInput {
  questionId?: string | undefined
  source: RequestSource
  stage: AuditStage
  decision: AuditDecision
  rule: string
  message: string
  sql?: string | undefined
  detail?: Record<string, unknown> | undefined
}

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  await getAppDb()
    .insert(auditEvents)
    .values({
      questionId: event.questionId ?? null,
      source: event.source,
      stage: event.stage,
      decision: event.decision,
      rule: event.rule,
      message: event.message,
      sql: event.sql ?? null,
      detail: event.detail ?? {},
    })
}

export interface AuditEventView {
  id: string
  questionId: string | null
  source: RequestSource
  stage: AuditStage
  decision: AuditDecision
  rule: string
  message: string
  sql: string | null
  detail: Record<string, unknown>
  createdAt: string
}

export const AUDIT_PAGE_DEFAULT = 50
export const AUDIT_PAGE_MAX = 200

/**
 * Admin audit log (14.2): newest first; `before` is the id of the last event of the
 * previous page (cursor on created_at, then id). Raw database error text is left
 * out of `detail` (never sent to clients); the SQLSTATE stays.
 */
export async function listAuditEvents(query: {
  decision?: AuditDecision | undefined
  limit: number
  before?: string | undefined
}): Promise<{ events: AuditEventView[]; nextBefore: string | null }> {
  const db = getAppDb()
  const conditions: SQL[] = []
  if (query.decision !== undefined) conditions.push(eq(auditEvents.decision, query.decision))
  if (query.before !== undefined) {
    const [cursor] = await db.select({ id: auditEvents.id }).from(auditEvents).where(eq(auditEvents.id, query.before))
    if (cursor === undefined) throw new AppError('NOT_FOUND', 'Audit cursor not found')
    // Compared in the database: timestamptz has microseconds, a JS Date only milliseconds.
    conditions.push(
      sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (SELECT a.created_at, a.id FROM audit_events a WHERE a.id = ${cursor.id})`,
    )
  }
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(query.limit + 1)
  const page = rows.slice(0, query.limit)
  const events = page.map((r) => {
    const detail = Object.fromEntries(Object.entries(r.detail).filter(([key]) => key !== 'dbMessage'))
    return {
      id: r.id,
      questionId: r.questionId,
      source: r.source,
      stage: r.stage,
      decision: r.decision,
      rule: r.rule,
      message: r.message,
      sql: r.sql,
      detail,
      createdAt: r.createdAt.toISOString(),
    }
  })
  return { events, nextBefore: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null }
}
