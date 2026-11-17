import { columnKind } from './chart'
import { formatPlain, inferFormat, type ValueFormat } from './units'

// Display helpers shared by the views.

/** One result cell as text; SQL NULL is shown by the caller. */
export function formatCell(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(value)
}

// A date or timestamp at midnight is shown as its date only ("2024-01-01").
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})(?:[ T]00:00(?::00(?:\.0+)?)?(?:Z|[+-]00(?::?00)?)?)$/

/**
 * One result cell for display (rows, charts and copied SQL keep the raw values). Numeric
 * cells follow their column's format (lib/units.ts): money 2 decimals, percents 1, counts 0,
 * thousands separators; ids and whole years stay as they are. The header carries the unit.
 */
export function formatResultCell(value: unknown, column: { name: string; type: string }, format?: ValueFormat): string {
  const kind = columnKind(column.type)
  if (kind === 'date' && typeof value === 'string') return MIDNIGHT.exec(value)?.[1] ?? value
  if (kind !== 'number') return formatCell(value)
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  // Not a finite number, or too large to format exactly: show the raw value.
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) return formatCell(value)
  return formatPlain(n, format ?? inferFormat(column, [value]))
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}
