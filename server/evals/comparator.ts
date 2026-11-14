// Execution-accuracy comparator (IMPLEMENTATION.md 20.3, D19): the gold and the
// generated SQL are both executed and their results compared.
//
// - Column count must match; column names are ignored.
// - Rows are compared as multisets, or in order when the item says order matters.
// - Numbers are rounded to 2 decimals. Postgres returns bigint and numeric values
//   as text, so a string that is a plain decimal number counts as that number
//   ('504' = 504 = '504.00').
// - A timestamp at midnight equals its date ('2024-01-01 00:00:00' = '2024-01-01'):
//   date_trunc and a date cast are the same answer. Other text is compared exactly.

export interface ComparableResult {
  columnCount: number
  rows: readonly (readonly unknown[])[]
}

export type Comparison =
  | { match: true }
  | { match: false; reason: 'column_count'; gold: number; generated: number }
  | { match: false; reason: 'row_count'; gold: number; generated: number }
  | { match: false; reason: 'rows' }

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2}) 00:00:00(?:\.0+)?$/

function round2(n: number): number {
  const rounded = Math.round(n * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}

/** One cell in a canonical, JSON-serialisable form. */
export function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? round2(value) : String(value)
  if (typeof value === 'bigint') return round2(Number(value))
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (DECIMAL.test(trimmed)) return round2(Number(trimmed))
    const midnight = MIDNIGHT.exec(value)
    return midnight?.[1] ?? value
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return Object.fromEntries(entries.map(([k, v]) => [k, normalizeValue(v)]))
  }
  return value
}

function rowKey(row: readonly unknown[]): string {
  return JSON.stringify(row.map(normalizeValue))
}

export function compareResults(
  gold: ComparableResult,
  generated: ComparableResult,
  options: { orderMatters: boolean },
): Comparison {
  if (gold.columnCount !== generated.columnCount) {
    return { match: false, reason: 'column_count', gold: gold.columnCount, generated: generated.columnCount }
  }
  if (gold.rows.length !== generated.rows.length) {
    return { match: false, reason: 'row_count', gold: gold.rows.length, generated: generated.rows.length }
  }
  const goldKeys = gold.rows.map(rowKey)
  const generatedKeys = generated.rows.map(rowKey)
  if (options.orderMatters) {
    return goldKeys.every((key, i) => key === generatedKeys[i]) ? { match: true } : { match: false, reason: 'rows' }
  }
  const counts = new Map<string, number>()
  for (const key of goldKeys) counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const key of generatedKeys) {
    const left = counts.get(key) ?? 0
    if (left === 0) return { match: false, reason: 'rows' }
    counts.set(key, left - 1)
  }
  return { match: true }
}
