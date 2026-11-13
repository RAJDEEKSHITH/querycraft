import { and, eq, notInArray, sql } from 'drizzle-orm'
import type { Pool } from 'pg'
import { getAppDb } from '../db/app.js'
import { columnValues } from '../db/schema.js'
import type { SchemaFile, ValueColumn } from './seed-files.js'

// kb:index, value part (IMPLEMENTATION.md 11.1, 11.3): loads the distinct values of
// the columns in seed/value-columns.json into column_values for pg_trgm lookup. No
// embeddings. The sampling query is fixed and code-defined (9.3 rule 2); its
// identifiers come only from the config after checking them against
// seed/schema.json, where the reader's columns, types and flags are recorded.

/** A value column must be small: a lookup list, not free text or a key. */
export const MAX_VALUES_PER_COLUMN = 2000

const TEXT_TYPE = /^(varchar|char|text)\b/

export function columnLabel(c: ValueColumn): string {
  return `${c.schema}.${c.table}.${c.column}`
}

/** Throws when a configured column is unknown, denied, PII or not text. */
export function checkValueColumns(config: readonly ValueColumn[], schema: SchemaFile): void {
  const seen = new Set<string>()
  for (const entry of config) {
    const label = columnLabel(entry)
    if (seen.has(label)) throw new Error(`value column ${label} is listed twice`)
    seen.add(label)
    const column = schema.tables
      .find((t) => t.schema === entry.schema && t.table === entry.table)
      ?.columns.find((c) => c.name === entry.column)
    if (column === undefined) throw new Error(`value column ${label} is not in seed/schema.json`)
    if (column.denied) throw new Error(`value column ${label} is denied`)
    if (column.pii !== null) throw new Error(`value column ${label} is PII`)
    if (!TEXT_TYPE.test(column.type)) throw new Error(`value column ${label} is not a text column (${column.type})`)
  }
}

function quoteIdentifier(name: string): string {
  // Names are already restricted to [a-z_][a-z0-9_]* by the seed-file schema.
  return `"${name.replaceAll('"', '""')}"`
}

async function sampleValues(reader: Pool, entry: ValueColumn): Promise<string[]> {
  const column = quoteIdentifier(entry.column)
  const table = `${quoteIdentifier(entry.schema)}.${quoteIdentifier(entry.table)}`
  const result = await reader.query<{ value: string }>(
    `SELECT DISTINCT btrim(${column}) AS value FROM ${table}
      WHERE ${column} IS NOT NULL AND btrim(${column}) <> '' ORDER BY 1 LIMIT $1`,
    [MAX_VALUES_PER_COLUMN + 1],
  )
  if (result.rows.length > MAX_VALUES_PER_COLUMN) {
    throw new Error(`value column ${columnLabel(entry)} has more than ${MAX_VALUES_PER_COLUMN} distinct values`)
  }
  return result.rows.map((r) => r.value)
}

export interface ValueLoadStats {
  columns: number
  values: number
}

/**
 * Replaces column_values with the current values of the configured columns.
 * Reads everything first, then writes in one transaction.
 */
export async function loadColumnValues(
  reader: Pool,
  config: readonly ValueColumn[],
  schema: SchemaFile,
): Promise<ValueLoadStats> {
  checkValueColumns(config, schema)
  const sampled: { entry: ValueColumn; values: string[] }[] = []
  for (const entry of config) {
    sampled.push({ entry, values: await sampleValues(reader, entry) })
  }
  const labels = config.map(columnLabel)
  await getAppDb().transaction(async (tx) => {
    const label = sql`${columnValues.schemaName} || '.' || ${columnValues.tableName} || '.' || ${columnValues.columnName}`
    await tx.delete(columnValues).where(notInArray(label, labels.length === 0 ? [''] : labels))
    for (const { entry, values } of sampled) {
      const sameColumn = and(
        eq(columnValues.schemaName, entry.schema),
        eq(columnValues.tableName, entry.table),
        eq(columnValues.columnName, entry.column),
      )
      await tx.delete(columnValues).where(values.length === 0 ? sameColumn : and(sameColumn, notInArray(columnValues.value, values)))
      if (values.length > 0) {
        await tx
          .insert(columnValues)
          .values(values.map((value) => ({ schemaName: entry.schema, tableName: entry.table, columnName: entry.column, value })))
          .onConflictDoNothing()
      }
    }
  })
  return { columns: config.length, values: sampled.reduce((sum, s) => sum + s.values.length, 0) }
}
