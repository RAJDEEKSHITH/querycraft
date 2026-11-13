import type { KbColumn } from '../db/schema.js'
import type { EmbeddingsClient } from '../retrieval/embeddings.js'
import {
  searchGlossary,
  searchTables,
  searchVerifiedExamples,
  tablesByName,
  type ExampleHit,
  type GlossaryHit,
} from '../retrieval/search.js'
import { lookupValues, type ValueMatch } from '../retrieval/value-lookup.js'
import { parseSql, referencedTables } from '../safety/parser.js'
import type { RequestSource } from './audit.service.js'

// Context retrieval for one question (IMPLEMENTATION.md 11.3): exactly one
// embedding call, then tables (top 8, plus tables of retrieved examples, max 12),
// verified examples (top 3), glossary terms (top 5, similarity ≥ 0.30) and stored
// values (pg_trgm, top 10). Denied columns are removed before anything is returned.

export const TABLE_TOP_K = 8
export const MAX_TABLES = 12
export const EXAMPLE_TOP_K = 3
export const GLOSSARY_TOP_K = 5
export const GLOSSARY_MIN_SIMILARITY = 0.3

export interface RetrievedTable {
  schema: string
  table: string
  description: string
  /** Allowed columns only (denied columns removed). */
  columns: KbColumn[]
  /** Null when the table was added because a retrieved example uses it. */
  similarity: number | null
}

export interface RetrievedContext {
  tables: RetrievedTable[]
  examples: ExampleHit[]
  glossary: GlossaryHit[]
  values: ValueMatch[]
}

/** Schema-qualified tables used by the examples' SQL, in example order. */
async function exampleTables(hits: readonly ExampleHit[]): Promise<{ schema: string; table: string }[]> {
  const tables: { schema: string; table: string }[] = []
  for (const hit of hits) {
    const parsed = await parseSql(hit.sql)
    if (!parsed.ok) continue
    for (const statement of parsed.statements) tables.push(...referencedTables(statement))
  }
  return tables
}

export async function retrieveContext(
  question: string,
  embeddings: EmbeddingsClient,
  source: RequestSource,
): Promise<RetrievedContext> {
  const [vector] = await embeddings.embed([question], { task: 'query', source })
  if (vector === undefined) {
    throw new Error('Embedding client returned no vector')
  }
  const [topTables, examples, glossary, values] = await Promise.all([
    searchTables(vector, TABLE_TOP_K),
    searchVerifiedExamples(vector, EXAMPLE_TOP_K),
    searchGlossary(vector, GLOSSARY_TOP_K, GLOSSARY_MIN_SIMILARITY),
    lookupValues(question),
  ])

  const seen = new Set(topTables.map((t) => `${t.schema}.${t.table}`))
  const extra: { schema: string; table: string }[] = []
  for (const t of await exampleTables(examples)) {
    const key = `${t.schema}.${t.table}`
    if (!seen.has(key) && seen.size < MAX_TABLES) {
      seen.add(key)
      extra.push(t)
    }
  }
  const tables = [...topTables, ...(await tablesByName(extra))].map((t) => ({
    ...t,
    columns: t.columns.filter((c) => !c.denied),
  }))
  return { tables, examples, glossary, values }
}
