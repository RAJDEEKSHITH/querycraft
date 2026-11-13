import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Drizzle schema for the app database (querycraft_app / querycraft_test).
// Tables are added per milestone (IMPLEMENTATION.md 10.3).

export const requestSource = pgEnum('request_source', ['app', 'mcp', 'eval'])
export const auditStage = pgEnum('audit_stage', ['input', 'validation', 'cost', 'execution', 'output'])
export const auditDecision = pgEnum('audit_decision', ['allowed', 'blocked', 'needs_approval'])

// M1. question_id gets its foreign key to questions in M3, when that table exists.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id'),
    source: requestSource('source').notNull(),
    stage: auditStage('stage').notNull(),
    decision: auditDecision('decision').notNull(),
    rule: text('rule').notNull(),
    message: text('message').notNull(),
    sql: text('sql'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_created_at_idx').on(t.createdAt), index('audit_events_decision_idx').on(t.decision)],
)
