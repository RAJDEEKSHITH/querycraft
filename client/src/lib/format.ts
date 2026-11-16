// Display helpers shared by the views.

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

export function formatNumber(n: number): string {
  return numberFormat.format(n)
}

export function formatCompact(n: number): string {
  return compactFormat.format(n)
}

/** One result cell as text; SQL NULL is shown by the caller. */
export function formatCell(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(value)
}

// Numeric result cells (display only; rows, charts and copied SQL keep the raw values):
// integer types get thousands separators; numeric / real / double precision also get
// exactly 2 decimals. Whole numbers in a date-part column (extract(year …) returns
// numeric) stay as they are, so 2024 never becomes "2,024.00".
const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint'])
const DECIMAL_TYPES = new Set(['numeric', 'real', 'double precision'])
const DATE_PART_NAME = /(^|_)(year|yr|quarter|month|week|day|hour)$/i
const integerCell = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const decimalCell = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** One result cell for display, using its column's type and name. */
export function formatResultCell(value: unknown, column: { name: string; type: string }): string {
  const base = column.type.replace(/\(.*\)$/, '').trim().toLowerCase()
  const integer = INTEGER_TYPES.has(base)
  if (!integer && !DECIMAL_TYPES.has(base)) return formatCell(value)
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  // Not a finite number, or too large to format exactly: show the raw value.
  if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER) return formatCell(value)
  if (Number.isInteger(n) && DATE_PART_NAME.test(column.name)) return String(n)
  return integer ? integerCell.format(n) : decimalCell.format(n)
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}
