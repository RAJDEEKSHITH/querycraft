import { and, asc, eq, sql } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { glossaryTerms, schemaTables, type KbColumn } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import type { EmbeddingsClient } from '../retrieval/embeddings.js'
import { reindexChanged, type ReindexStats } from '../retrieval/indexer.js'

// Admin knowledge-base management (F14, IMPLEMENTATION.md 14.2): table
// descriptions and the glossary. An edit changes the text only; the stored
// embedding is replaced when the admin re-indexes (changed entries only).

export interface TableView {
  id: string
  schema: string
  table: string
  description: string
  columns: KbColumn[]
  updatedAt: string
  /** Has an embedding (an edited description is re-embedded by the next re-index). */
  indexed: boolean
}

export interface GlossaryView {
  id: string
  term: string
  definition: string
  sqlHint: string | null
  updatedAt: string
}

const tableColumns = {
  id: schemaTables.id,
  schema: schemaTables.schemaName,
  table: schemaTables.tableName,
  description: schemaTables.description,
  columns: schemaTables.columns,
  updatedAt: schemaTables.updatedAt,
  indexed: sql<boolean>`${schemaTables.embedding} IS NOT NULL`,
}

function tableView(row: Omit<TableView, 'updatedAt'> & { updatedAt: Date }): TableView {
  return { ...row, updatedAt: row.updatedAt.toISOString() }
}

export async function listTables(): Promise<TableView[]> {
  const rows = await getAppDb()
    .select(tableColumns)
    .from(schemaTables)
    .orderBy(asc(schemaTables.schemaName), asc(schemaTables.tableName))
  return rows.map(tableView)
}

/** One table of the knowledge base by schema and name, or null. */
export async function findTable(schema: string, table: string): Promise<TableView | null> {
  const [row] = await getAppDb()
    .select(tableColumns)
    .from(schemaTables)
    .where(and(eq(schemaTables.schemaName, schema), eq(schemaTables.tableName, table)))
  return row === undefined ? null : tableView(row)
}

export async function updateTableDescription(id: string, description: string): Promise<TableView> {
  const [row] = await getAppDb()
    .update(schemaTables)
    .set({ description, updatedAt: sql`now()` })
    .where(eq(schemaTables.id, id))
    .returning(tableColumns)
  if (row === undefined) throw new AppError('NOT_FOUND', 'Table not found')
  return tableView(row)
}

const glossaryColumns = {
  id: glossaryTerms.id,
  term: glossaryTerms.term,
  definition: glossaryTerms.definition,
  sqlHint: glossaryTerms.sqlHint,
  updatedAt: glossaryTerms.updatedAt,
}

function glossaryView(row: { id: string; term: string; definition: string; sqlHint: string | null; updatedAt: Date }): GlossaryView {
  return { ...row, updatedAt: row.updatedAt.toISOString() }
}

/** Postgres unique violation (duplicate glossary term). */
function isUniqueViolation(err: unknown): boolean {
  const cause = err instanceof Error && err.cause !== undefined ? err.cause : err
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505'
}

async function uniqueTerm<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError('INVALID_STATE', 'A glossary term with this name already exists', { cause: err })
    throw err
  }
}

export async function listGlossary(): Promise<GlossaryView[]> {
  const rows = await getAppDb().select(glossaryColumns).from(glossaryTerms).orderBy(asc(glossaryTerms.term))
  return rows.map(glossaryView)
}

export async function createGlossaryTerm(input: { term: string; definition: string; sqlHint?: string | null | undefined }): Promise<GlossaryView> {
  const [row] = await uniqueTerm(() =>
    getAppDb()
      .insert(glossaryTerms)
      .values({ term: input.term, definition: input.definition, sqlHint: input.sqlHint ?? null })
      .returning(glossaryColumns),
  )
  if (row === undefined) throw new Error('glossary term not created')
  return glossaryView(row)
}

export async function updateGlossaryTerm(
  id: string,
  patch: { term?: string | undefined; definition?: string | undefined; sqlHint?: string | null | undefined },
): Promise<GlossaryView> {
  const [row] = await uniqueTerm(() =>
    getAppDb()
      .update(glossaryTerms)
      .set({
        ...(patch.term === undefined ? {} : { term: patch.term }),
        ...(patch.definition === undefined ? {} : { definition: patch.definition }),
        ...(patch.sqlHint === undefined ? {} : { sqlHint: patch.sqlHint }),
        updatedAt: sql`now()`,
      })
      .where(eq(glossaryTerms.id, id))
      .returning(glossaryColumns),
  )
  if (row === undefined) throw new AppError('NOT_FOUND', 'Glossary term not found')
  return glossaryView(row)
}

export async function deleteGlossaryTerm(id: string): Promise<void> {
  const deleted = await getAppDb().delete(glossaryTerms).where(eq(glossaryTerms.id, id)).returning({ id: glossaryTerms.id })
  if (deleted.length === 0) throw new AppError('NOT_FOUND', 'Glossary term not found')
}

/** Re-embeds changed tables, verified examples and glossary terms (uses the embedding quota). */
export async function reindex(embeddings: EmbeddingsClient): Promise<ReindexStats> {
  return reindexChanged(embeddings)
}
