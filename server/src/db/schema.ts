import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

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

// M2 — knowledge base and usage (IMPLEMENTATION.md 10.3, 11).

/** Embedding size of gemini-embedding-001 with outputDimensionality 768 (D27). */
export const EMBEDDING_DIMENSIONS = 768

/** One column of an introspected table, as stored in `schema_tables.columns`. */
export interface KbColumn {
  name: string
  type: string
  nullable: boolean
  fk: { schema: string; table: string; column: string } | null
  pii: 'email' | 'phone' | null
  denied: boolean
}

export const exampleStatus = pgEnum('example_status', ['pending', 'verified', 'rejected'])
export const exampleSource = pgEnum('example_source', ['seed', 'feedback', 'admin'])

// `embedding` and `content_hash` are set together by the indexer; a row without an
// embedding (new, edited or pending) is never returned by retrieval.

export const schemaTables = pgTable(
  'schema_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaName: text('schema_name').notNull(),
    tableName: text('table_name').notNull(),
    description: text('description').notNull(),
    columns: jsonb('columns').$type<KbColumn[]>().notNull(),
    contentHash: text('content_hash'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('schema_tables_schema_table_key').on(t.schemaName, t.tableName),
    index('schema_tables_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
)

export const examples = pgTable(
  'examples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    question: text('question').notNull(),
    sql: text('sql').notNull(),
    status: exampleStatus('status').notNull(),
    source: exampleSource('source').notNull(),
    contentHash: text('content_hash'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (t) => [
    index('examples_status_idx').on(t.status),
    index('examples_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
)

export const glossaryTerms = pgTable(
  'glossary_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    term: text('term').notNull().unique('glossary_terms_term_key'),
    definition: text('definition').notNull(),
    sqlHint: text('sql_hint'),
    contentHash: text('content_hash'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('glossary_terms_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))],
)

export const columnValues = pgTable(
  'column_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    schemaName: text('schema_name').notNull(),
    tableName: text('table_name').notNull(),
    columnName: text('column_name').notNull(),
    value: text('value').notNull(),
  },
  (t) => [
    unique('column_values_column_value_key').on(t.schemaName, t.tableName, t.columnName, t.value),
    index('column_values_value_trgm_idx').using('gin', t.value.op('gin_trgm_ops')),
  ],
)

export const dailyUsage = pgTable(
  'daily_usage',
  {
    day: date('day', { mode: 'string' }).notNull(),
    source: requestSource('source').notNull(),
    llmTokens: integer('llm_tokens').notNull().default(0),
    embeddingTokens: integer('embedding_tokens').notNull().default(0),
    llmRequests: integer('llm_requests').notNull().default(0),
    embeddingRequests: integer('embedding_requests').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.source] })],
)
