import { createHash } from 'node:crypto'
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { examples, glossaryTerms, schemaTables } from '../db/schema.js'
import type { GlossaryEntry, SchemaFile, SeedExample, TableDescriptions } from '../kb/seed-files.js'
import { validateSql } from '../safety/validate.js'
import { MAX_EMBEDDING_BATCH, type EmbeddingsClient } from './embeddings.js'
import { tableEmbeddingText } from './table-text.js'

// kb:index, knowledge part (IMPLEMENTATION.md 11.1, 11.2):
// 1. check the inputs (every table described, every example SQL passes the validator);
// 2. sync rows from the seed files in one transaction;
// 3. embed only rows whose content_hash differs (outside any transaction, CLAUDE.md 9);
// 4. store vectors and hashes after each batch, so a failed later batch (e.g. a
//    rate limit) keeps the earlier ones and a re-run embeds only what is left.
// Re-running with unchanged inputs makes no embedding call. Only verified examples
// are embedded; pending and rejected ones never reach retrieval.

export interface KnowledgeInput {
  schema: SchemaFile
  descriptions: TableDescriptions
  examples: readonly SeedExample[]
  glossary: readonly GlossaryEntry[]
}

export interface IndexStats {
  tables: number
  examples: number
  glossary: number
  embedded: number
  deletedTables: number
  deletedSeedExamples: number
}

/** Hash of exactly what was embedded, with which model and size. */
export function contentHash(model: string, dimensions: number, text: string): string {
  return createHash('sha256').update(`${model}\n${dimensions}\n${text}`).digest('hex')
}

export function glossaryEmbeddingText(term: string, definition: string): string {
  return `${term}: ${definition}`
}

async function checkInput(input: KnowledgeInput): Promise<void> {
  const missing = input.schema.tables.filter((t) => input.descriptions[`${t.schema}.${t.table}`] === undefined)
  if (missing.length > 0) {
    throw new Error(`${missing.length} table(s) have no description; run kb:describe and review seed/table-descriptions.json`)
  }
  for (const [i, example] of input.examples.entries()) {
    const result = await validateSql(example.sql)
    if (!result.ok) {
      throw new Error(`seed example ${i + 1} fails validation (${result.rule})`)
    }
  }
}

async function syncRows(input: KnowledgeInput): Promise<{ deletedTables: number; deletedSeedExamples: number }> {
  return getAppDb().transaction(async (tx) => {
    const tableNames: string[] = []
    for (const t of input.schema.tables) {
      tableNames.push(`${t.schema}.${t.table}`)
      const description = input.descriptions[`${t.schema}.${t.table}`] ?? ''
      await tx
        .insert(schemaTables)
        .values({ schemaName: t.schema, tableName: t.table, description, columns: t.columns })
        .onConflictDoUpdate({
          target: [schemaTables.schemaName, schemaTables.tableName],
          set: { description, columns: t.columns, updatedAt: sql`now()` },
        })
    }
    const deletedTables = await tx
      .delete(schemaTables)
      .where(notInArray(sql`${schemaTables.schemaName} || '.' || ${schemaTables.tableName}`, tableNames))
      .returning({ id: schemaTables.id })

    const seedQuestions = input.examples.map((e) => e.question)
    const existing = await tx
      .select({ id: examples.id, question: examples.question, sql: examples.sql })
      .from(examples)
      .where(eq(examples.source, 'seed'))
    const byQuestion = new Map(existing.map((e) => [e.question, e]))
    for (const example of input.examples) {
      const row = byQuestion.get(example.question)
      if (row === undefined) {
        await tx.insert(examples).values({
          question: example.question,
          sql: example.sql,
          status: 'verified',
          source: 'seed',
          verifiedAt: sql`now()`,
        })
      } else if (row.sql !== example.sql) {
        // Status is kept: a seed example an admin rejected stays rejected.
        await tx.update(examples).set({ sql: example.sql }).where(eq(examples.id, row.id))
      }
    }
    const deletedSeedExamples =
      seedQuestions.length === 0
        ? await tx.delete(examples).where(eq(examples.source, 'seed')).returning({ id: examples.id })
        : await tx
            .delete(examples)
            .where(and(eq(examples.source, 'seed'), notInArray(examples.question, seedQuestions)))
            .returning({ id: examples.id })

    // Glossary terms are upserted, never deleted (admins add their own terms).
    for (const entry of input.glossary) {
      await tx
        .insert(glossaryTerms)
        .values({ term: entry.term, definition: entry.definition, sqlHint: entry.sqlHint })
        .onConflictDoUpdate({
          target: glossaryTerms.term,
          set: { definition: entry.definition, sqlHint: entry.sqlHint, updatedAt: sql`now()` },
        })
    }
    return { deletedTables: deletedTables.length, deletedSeedExamples: deletedSeedExamples.length }
  })
}

type Kind = 'table' | 'example' | 'glossary'

interface Pending {
  kind: Kind
  id: string
  text: string
  hash: string
}

/** Rows whose stored hash differs from the hash of their current text. */
async function pendingEmbeddings(model: string, dimensions: number): Promise<Pending[]> {
  const db = getAppDb()
  const pending: Pending[] = []
  const add = (kind: Kind, id: string, text: string, stored: string | null): void => {
    const hash = contentHash(model, dimensions, text)
    if (stored !== hash) pending.push({ kind, id, text, hash })
  }
  for (const t of await db.select().from(schemaTables)) {
    add('table', t.id, tableEmbeddingText({ schema: t.schemaName, table: t.tableName, columns: t.columns }, t.description), t.contentHash)
  }
  for (const e of await db.select().from(examples).where(eq(examples.status, 'verified'))) {
    add('example', e.id, e.question, e.contentHash)
  }
  for (const g of await db.select().from(glossaryTerms)) {
    add('glossary', g.id, glossaryEmbeddingText(g.term, g.definition), g.contentHash)
  }
  return pending
}

async function storeEmbeddings(pending: readonly Pending[], vectors: readonly number[][]): Promise<void> {
  await getAppDb().transaction(async (tx) => {
    for (const [i, row] of pending.entries()) {
      const set = { embedding: vectors[i] ?? null, contentHash: row.hash }
      if (row.kind === 'table') await tx.update(schemaTables).set(set).where(eq(schemaTables.id, row.id))
      else if (row.kind === 'example') await tx.update(examples).set(set).where(eq(examples.id, row.id))
      else await tx.update(glossaryTerms).set(set).where(eq(glossaryTerms.id, row.id))
    }
  })
}

export async function indexKnowledge(input: KnowledgeInput, embeddings: EmbeddingsClient): Promise<IndexStats> {
  await checkInput(input)
  const deleted = await syncRows(input)
  const pending = await pendingEmbeddings(embeddings.model, embeddings.dimensions)
  for (let start = 0; start < pending.length; start += MAX_EMBEDDING_BATCH) {
    const batch = pending.slice(start, start + MAX_EMBEDDING_BATCH)
    const vectors = await embeddings.embed(
      batch.map((p) => p.text),
      { task: 'document', source: 'app' },
    )
    await storeEmbeddings(batch, vectors)
  }
  return {
    tables: input.schema.tables.length,
    examples: input.examples.length,
    glossary: input.glossary.length,
    embedded: pending.length,
    ...deleted,
  }
}
