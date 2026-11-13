import { getAppDb } from '../db/app.js'
import { auditDecision, auditEvents, auditStage, requestSource } from '../db/schema.js'

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
