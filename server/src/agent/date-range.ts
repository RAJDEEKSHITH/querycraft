import { z } from 'zod'
import { parseSql } from '../safety/parser.js'
import type { RequestSource } from '../services/audit.service.js'
import { runSafeQuery } from '../services/safe-query.service.js'

// Date-range check after a zero-row result (IMPLEMENTATION.md 12.3). When the SQL
// filters on a date or timestamp column, the agent looks up that column's actual
// range with one fixed, code-built query. The query goes through the full safety
// pipeline (validate → cost → execute), so it is checked and audited like any other.

export interface DateColumn {
  schema: string
  table: string
  column: string
}

/** Smallest and largest value of a date column, as `YYYY-MM-DD`. */
export interface DataRange extends DateColumn {
  min: string
  max: string
}

/** The retrieved-context view of a table: only columns the model was allowed to see. */
export interface ContextTable {
  schema: string
  table: string
  columns: readonly { name: string; type: string }[]
}

const DATE_TYPE = /^(date|timestamp)/

type TableRef = { schema: string; table: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Schema-qualified `RangeVar`s by the name a column reference uses (alias, else table name). */
function collectTables(node: unknown, out: Map<string, TableRef>): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collectTables(child, out))
    return
  }
  if (!isRecord(node)) return
  for (const [key, value] of Object.entries(node)) {
    if (key === 'RangeVar' && isRecord(value)) {
      const { schemaname, relname, alias } = value
      if (typeof schemaname === 'string' && typeof relname === 'string') {
        const aliasName = isRecord(alias) && typeof alias['aliasname'] === 'string' ? alias['aliasname'] : relname
        out.set(aliasName, { schema: schemaname, table: relname })
      }
    }
    collectTables(value, out)
  }
}

/** Name parts of a `ColumnRef` (`[col]`, `[alias, col]`, `[schema, table, col]`); null for `*`. */
function columnRefParts(ref: Record<string, unknown>): string[] | null {
  const fields = ref['fields']
  if (!Array.isArray(fields)) return null
  const parts: string[] = []
  for (const field of fields) {
    const name = isRecord(field) && isRecord(field['String']) ? field['String']['sval'] : undefined
    if (typeof name !== 'string') return null
    parts.push(name)
  }
  return parts
}

/**
 * Column references inside filters (`WHERE` and join `ON` conditions), in parse-tree
 * order. `IS [NOT] NULL` tests are not period filters and are skipped; a nested
 * `SELECT` starts outside any filter (its select list is not a filter).
 */
function collectFilterRefs(node: unknown, inFilter: boolean, out: string[][]): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collectFilterRefs(child, inFilter, out))
    return
  }
  if (!isRecord(node)) return
  for (const [key, value] of Object.entries(node)) {
    if (key === 'NullTest') continue
    if (key === 'ColumnRef' && isRecord(value)) {
      const parts = columnRefParts(value)
      if (inFilter && parts !== null) out.push(parts)
      continue
    }
    const childInFilter = key === 'SelectStmt' ? false : inFilter || key === 'whereClause' || key === 'quals'
    collectFilterRefs(value, childInFilter, out)
  }
}

/**
 * Date and timestamp columns the SQL filters on, resolved through table aliases and
 * checked against the retrieved context (only columns the model was shown, so a name
 * the model made up is never used). Unparseable SQL gives an empty list.
 */
export async function findDateFilterColumns(sql: string, tables: readonly ContextTable[]): Promise<DateColumn[]> {
  const parsed = await parseSql(sql)
  if (!parsed.ok || parsed.statements.length !== 1) return []
  const statement = parsed.statements[0]
  const byName = new Map<string, TableRef>()
  collectTables(statement, byName)
  const refs: string[][] = []
  collectFilterRefs(statement, false, refs)

  const isDateColumn = (ref: TableRef, column: string): boolean =>
    tables.some(
      (t) =>
        t.schema === ref.schema &&
        t.table === ref.table &&
        t.columns.some((c) => c.name === column && DATE_TYPE.test(c.type)),
    )
  const found = new Map<string, DateColumn>()
  const add = (ref: TableRef, column: string): void => {
    if (isDateColumn(ref, column)) found.set(`${ref.schema}.${ref.table}.${column}`, { ...ref, column })
  }
  for (const parts of refs) {
    const [a, b, c] = parts
    if (parts.length === 1 && a !== undefined) {
      for (const ref of byName.values()) add(ref, a)
    } else if (parts.length === 2 && a !== undefined && b !== undefined) {
      const ref = byName.get(a)
      if (ref !== undefined) add(ref, b)
    } else if (parts.length === 3 && a !== undefined && b !== undefined && c !== undefined) {
      add({ schema: a, table: b }, c)
    }
  }
  return [...found.values()]
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** The fixed range query for one column. */
export function dataRangeSql(column: DateColumn): string {
  const col = quoteIdentifier(column.column)
  return `SELECT min(${col})::date AS min_value, max(${col})::date AS max_value FROM ${quoteIdentifier(column.schema)}.${quoteIdentifier(column.table)}`
}

const rangeRowSchema = z.tuple([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])

/**
 * Looks up the range of the first date column the SQL filters on. Returns null when
 * there is no such column, the query is not allowed (it is never sent for approval),
 * or the table is empty; the run then continues without a range.
 */
export async function lookUpDataRange(
  sql: string,
  tables: readonly ContextTable[],
  context: { source: RequestSource; questionId: string },
): Promise<DataRange | null> {
  const column = (await findDateFilterColumns(sql, tables))[0]
  if (column === undefined) return null
  const result = await runSafeQuery({
    sql: dataRangeSql(column),
    source: context.source,
    softLimit: 'block',
    questionId: context.questionId,
  })
  if (result.status !== 'executed') return null
  const row = rangeRowSchema.safeParse(result.rows[0])
  if (!row.success) return null
  const [min, max] = row.data
  return { ...column, min, max }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function monthYear(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1] ?? date.slice(5, 7)} ${date.slice(0, 4)}`
}

/** The range for people: "May 2022 to June 2025". */
export function rangeInWords(range: Pick<DataRange, 'min' | 'max'>): string {
  return `${monthYear(range.min)} to ${monthYear(range.max)}`
}

/**
 * Concrete clarify options for a period outside the data (12.3): the latest three
 * complete calendar years, then all available data.
 */
export function rangeOptions(range: Pick<DataRange, 'min' | 'max'>): string[] {
  const years = completeYears(range)
  const yearOptions: string[] = []
  if (years !== null) {
    for (let y = Math.max(years.first, years.last - 2); y <= years.last; y += 1) yearOptions.push(String(y))
  }
  return [...yearOptions, `All available data (${rangeInWords(range)})`]
}

/** First and last calendar year fully inside the range; null when there is none. */
export function completeYears(range: Pick<DataRange, 'min' | 'max'>): { first: number; last: number } | null {
  const first = Number(range.min.slice(0, 4)) + (range.min.slice(5) === '01-01' ? 0 : 1)
  const last = Number(range.max.slice(0, 4)) - (range.max.slice(5) === '12-31' ? 0 : 1)
  return first <= last ? { first, last } : null
}
