import { desc, eq, sql } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { examples, exampleStatus } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import { stripControlCharacters } from '../agent/graph.js'
import { runSafeQuery } from './safe-query.service.js'

// Admin example management (F13, F14, IMPLEMENTATION.md 14.2). Only verified
// examples reach prompts, and only the admin verifies. Verifying (or creating) an
// example requires its SQL to pass the safety pipeline and execute. Embeddings are
// written only by the re-index; a new example has none until then, so retrieval
// skips it.

export type ExampleStatus = (typeof exampleStatus.enumValues)[number]

export interface ExampleView {
  id: string
  question: string
  sql: string
  status: ExampleStatus
  source: string
  createdAt: string
  verifiedAt: string | null
  /** Has an embedding, so retrieval can return it (when verified). */
  indexed: boolean
}

type ExampleRow = Pick<
  typeof examples.$inferSelect,
  'id' | 'question' | 'sql' | 'status' | 'source' | 'createdAt' | 'verifiedAt'
> & { indexed: boolean }

const columns = {
  id: examples.id,
  question: examples.question,
  sql: examples.sql,
  status: examples.status,
  source: examples.source,
  createdAt: examples.createdAt,
  verifiedAt: examples.verifiedAt,
  indexed: sql<boolean>`${examples.embedding} IS NOT NULL`,
}

function toView(row: ExampleRow): ExampleView {
  return { ...row, createdAt: row.createdAt.toISOString(), verifiedAt: row.verifiedAt?.toISOString() ?? null }
}

/** The SQL must pass validation and execute (soft limit blocks: no approval here). */
async function assertExecutes(query: string): Promise<void> {
  const result = await runSafeQuery({ sql: query, source: 'app', softLimit: 'block' })
  if (result.status === 'executed') return
  if (result.status === 'blocked') {
    throw new AppError('VALIDATION_ERROR', 'The SQL does not pass the safety pipeline', {
      details: { stage: result.stage, rule: result.rule, message: result.message },
    })
  }
  throw new AppError('VALIDATION_ERROR', 'The SQL is above the cost limit')
}

export async function listExamples(status: ExampleStatus | undefined): Promise<ExampleView[]> {
  const query = getAppDb().select(columns).from(examples)
  const rows = await (status === undefined ? query : query.where(eq(examples.status, status))).orderBy(desc(examples.createdAt))
  return rows.map(toView)
}

export async function createExample(input: { question: string; sql: string }): Promise<ExampleView> {
  await assertExecutes(input.sql)
  const [row] = await getAppDb()
    .insert(examples)
    .values({
      question: stripControlCharacters(input.question).trim(),
      sql: input.sql,
      status: 'verified',
      source: 'admin',
      verifiedAt: sql`now()`,
    })
    .returning(columns)
  if (row === undefined) throw new Error('example not created')
  return toView(row)
}

export async function updateExample(
  id: string,
  patch: { question?: string | undefined; sql?: string | undefined; status?: ExampleStatus | undefined },
): Promise<ExampleView> {
  const db = getAppDb()
  const [current] = await db.select({ sql: examples.sql, status: examples.status }).from(examples).where(eq(examples.id, id))
  if (current === undefined) throw new AppError('NOT_FOUND', 'Example not found')
  const status = patch.status ?? current.status
  if (status === 'verified') await assertExecutes(patch.sql ?? current.sql)
  const [row] = await db
    .update(examples)
    .set({
      ...(patch.question === undefined ? {} : { question: stripControlCharacters(patch.question).trim() }),
      ...(patch.sql === undefined ? {} : { sql: patch.sql }),
      status,
      verifiedAt: status === 'verified' ? (current.status === 'verified' ? undefined : sql`now()`) : null,
    })
    .where(eq(examples.id, id))
    .returning(columns)
  if (row === undefined) throw new AppError('NOT_FOUND', 'Example not found')
  return toView(row)
}
