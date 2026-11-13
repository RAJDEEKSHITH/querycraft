import { and, asc, cosineDistance, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { examples, glossaryTerms, schemaTables, type KbColumn } from '../db/schema.js'

// Vector search over the knowledge base (pgvector cosine distance, HNSW indexes).
// Rows without an embedding are never returned; examples only when verified.

export interface TableHit {
  schema: string
  table: string
  description: string
  columns: KbColumn[]
  similarity: number | null
}

export interface ExampleHit {
  id: string
  question: string
  sql: string
  similarity: number
}

export interface GlossaryHit {
  term: string
  definition: string
  sqlHint: string | null
  similarity: number
}

export async function searchTables(vector: readonly number[], limit: number): Promise<TableHit[]> {
  const distance = cosineDistance(schemaTables.embedding, [...vector])
  const rows = await getAppDb()
    .select({
      schema: schemaTables.schemaName,
      table: schemaTables.tableName,
      description: schemaTables.description,
      columns: schemaTables.columns,
      similarity: sql<string>`1 - (${distance})`,
    })
    .from(schemaTables)
    .where(isNotNull(schemaTables.embedding))
    .orderBy(asc(distance))
    .limit(limit)
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }))
}

/** Tables by name (no similarity), for tables referenced by retrieved examples. */
export async function tablesByName(names: readonly { schema: string; table: string }[]): Promise<TableHit[]> {
  if (names.length === 0) return []
  const keys = names.map((n) => `${n.schema}.${n.table}`)
  const rows = await getAppDb()
    .select({
      schema: schemaTables.schemaName,
      table: schemaTables.tableName,
      description: schemaTables.description,
      columns: schemaTables.columns,
    })
    .from(schemaTables)
    .where(inArray(sql`${schemaTables.schemaName} || '.' || ${schemaTables.tableName}`, keys))
  const byKey = new Map(rows.map((r) => [`${r.schema}.${r.table}`, r]))
  return keys.flatMap((k) => {
    const row = byKey.get(k)
    return row === undefined ? [] : [{ ...row, similarity: null }]
  })
}

export async function searchVerifiedExamples(vector: readonly number[], limit: number): Promise<ExampleHit[]> {
  const distance = cosineDistance(examples.embedding, [...vector])
  const rows = await getAppDb()
    .select({ id: examples.id, question: examples.question, sql: examples.sql, similarity: sql<string>`1 - (${distance})` })
    .from(examples)
    .where(and(eq(examples.status, 'verified'), isNotNull(examples.embedding)))
    .orderBy(asc(distance))
    .limit(limit)
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }))
}

export async function searchGlossary(vector: readonly number[], limit: number, minSimilarity: number): Promise<GlossaryHit[]> {
  const distance = cosineDistance(glossaryTerms.embedding, [...vector])
  const rows = await getAppDb()
    .select({
      term: glossaryTerms.term,
      definition: glossaryTerms.definition,
      sqlHint: glossaryTerms.sqlHint,
      similarity: sql<string>`1 - (${distance})`,
    })
    .from(glossaryTerms)
    .where(and(isNotNull(glossaryTerms.embedding), sql`1 - (${distance}) >= ${minSimilarity}`))
    .orderBy(asc(distance))
    .limit(limit)
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }))
}
