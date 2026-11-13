import type { KbColumn } from '../db/schema.js'

// Compact table text (IMPLEMENTATION.md 11.1, 17): no comments, abbreviated types,
// denied columns never included. Used for embeddings and prompts.

export interface TableShape {
  schema: string
  table: string
  columns: readonly KbColumn[]
}

function columnText(column: KbColumn): string {
  const fk = column.fk === null ? '' : ` (fk → ${column.fk.schema}.${column.fk.table}.${column.fk.column})`
  return `${column.name} ${column.type}${fk}`
}

/** `name type (fk → target), ...` for the columns that may be shown. */
export function compactColumns(columns: readonly KbColumn[]): string {
  return columns
    .filter((c) => !c.denied)
    .map(columnText)
    .join(', ')
}

/** The embedded text of a table: `schema.table: description. Columns: ...`. */
export function tableEmbeddingText(table: TableShape, description: string): string {
  const sentence = description.trim().replace(/\.+$/, '')
  return `${table.schema}.${table.table}: ${sentence}. Columns: ${compactColumns(table.columns)}`
}
