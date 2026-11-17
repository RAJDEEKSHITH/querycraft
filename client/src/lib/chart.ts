import type { Column } from '../types/api'
import { humanize, humanizeLower, inferFormat, titleWithUnit, unitLabel, type ValueFormat } from './units'

// Chart rule (IMPLEMENTATION.md 15): one dimension column (text, date, or a numeric year
// column) plus 1–3 numeric columns and at most 50 rows → date: line, text: bar, year:
// line for 3+ years and bars for fewer; otherwise no chart.

export const CHART_MAX_ROWS = 50
export const CHART_MAX_SERIES = 3

// Type names as the server reports them (pg_catalog.format_type).
const NUMERIC_TYPES = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision'])
const TEXT_TYPES = new Set(['text', 'character varying', 'character', 'name', '"char"', 'citext'])
const DATE_TYPES = new Set(['date', 'timestamp without time zone', 'timestamp with time zone'])

export type ColumnKind = 'number' | 'text' | 'date' | 'other'

export function columnKind(type: string): ColumnKind {
  const base = type.replace(/\(.*\)$/, '').trim().toLowerCase()
  if (NUMERIC_TYPES.has(base)) return 'number'
  if (TEXT_TYPES.has(base)) return 'text'
  if (DATE_TYPES.has(base)) return 'date'
  return 'other'
}

export type DimensionKind = 'text' | 'date' | 'year'

export interface ChartSpec {
  kind: 'line' | 'bar'
  dimension: number
  dimensionKind: DimensionKind
  measures: number[]
}

/** A finite number from a result cell (int8 and numeric arrive as strings); null otherwise. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** A numeric column named "year" or "…year" whose every value is a whole year 1900–2100. */
export function isYearColumn(name: string, rows: unknown[][], index: number): boolean {
  if (!/year$/i.test(name)) return false
  return rows.every((row) => {
    const n = toNumber(row[index])
    return n !== null && Number.isInteger(n) && n >= 1900 && n <= 2100
  })
}

export function chooseChart(columns: Column[], rows: unknown[][]): ChartSpec | null {
  if (rows.length === 0 || rows.length > CHART_MAX_ROWS) return null
  const kinds = columns.map((c) => columnKind(c.type))
  const years = columns.map((c, i) => kinds[i] === 'number' && isYearColumn(c.name, rows, i))
  const dimensions = kinds.flatMap((k, i) => (k === 'text' || k === 'date' || years[i] === true ? [i] : []))
  const measures = kinds.flatMap((k, i) => (k === 'number' && years[i] !== true ? [i] : []))
  const [dimension] = dimensions
  if (dimension === undefined || dimensions.length !== 1) return null
  if (measures.length < 1 || measures.length > CHART_MAX_SERIES) return null
  if (dimensions.length + measures.length !== columns.length) return null
  // Every measure cell must be a number or SQL NULL.
  const numeric = rows.every((row) => measures.every((m) => row[m] === null || toNumber(row[m]) !== null))
  if (!numeric) return null
  const dimensionKind: DimensionKind = years[dimension] === true ? 'year' : kinds[dimension] === 'date' ? 'date' : 'text'
  const kind = dimensionKind === 'date' || (dimensionKind === 'year' && rows.length >= 3) ? 'line' : 'bar'
  return { kind, dimension, dimensionKind, measures }
}

export interface ChartPoint {
  label: string
  values: (number | null)[]
}

/** Points in display order: dates and years ascending, text in result order. */
export function chartPoints(spec: ChartSpec, rows: unknown[][]): ChartPoint[] {
  const points = rows.map((row) => {
    const cell = row[spec.dimension]
    const label = cell === null || cell === undefined ? '(null)' : spec.dimensionKind === 'year' ? String(toNumber(cell)) : String(cell)
    return { label, values: spec.measures.map((m) => toNumber(row[m])) }
  })
  if (spec.dimensionKind === 'year') points.sort((a, b) => Number(a.label) - Number(b.label))
  if (spec.dimensionKind === 'date') points.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return points
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/

/**
 * Readable date labels at the coarsest granularity all values share: "2024" when every
 * value is 1 January, "Jan 2024" when every value is the 1st, else "5 Jan 2024" (plus the
 * time when one is set). Values are shown as written, without time-zone conversion.
 */
export function dateLabels(labels: string[]): string[] {
  const parsed = labels.map((l) => DATE_TEXT.exec(l))
  if (parsed.some((p) => p === null)) return labels
  const parts = parsed.map((p) => ({
    y: p?.[1] ?? '',
    m: Number(p?.[2]),
    d: Number(p?.[3]),
    time: p?.[4] !== undefined && `${p[4]}:${p[5] ?? '00'}:${p[6] ?? '00'}` !== '00:00:00' ? `${p[4]}:${p[5] ?? '00'}` : null,
  }))
  const anyTime = parts.some((p) => p.time !== null)
  const years = !anyTime && parts.every((p) => p.m === 1 && p.d === 1)
  const months = !anyTime && parts.every((p) => p.d === 1)
  return parts.map((p) => {
    const month = MONTHS[p.m - 1] ?? String(p.m)
    if (years) return p.y
    if (months) return `${month} ${p.y}`
    return `${p.d} ${month} ${p.y}${p.time === null ? '' : ` ${p.time}`}`
  })
}

/** Display labels for the dimension values. */
export function dimensionLabels(spec: ChartSpec, points: ChartPoint[]): string[] {
  const labels = points.map((p) => p.label)
  return spec.dimensionKind === 'date' ? dateLabels(labels) : labels
}

/** Characters in a label of the given width at the chart's 12 px axis font (approximate). */
export const CHAR_WIDTH = 7

export function truncateLabel(label: string, maxChars: number): string {
  if (label.length <= maxChars) return label
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`
}

/** Horizontal bars when there are more than 8 categories, a label is long, or labels would not fit under their bars. */
export function barOrientation(labels: string[], plotWidth: number): 'vertical' | 'horizontal' {
  if (labels.length > 8) return 'horizontal'
  const longest = Math.max(0, ...labels.map((l) => l.length))
  if (longest > 16) return 'horizontal'
  const band = plotWidth / Math.max(1, labels.length)
  return longest * CHAR_WIDTH + 8 > band ? 'horizontal' : 'vertical'
}

const YEAR_SUFFIX = /^(.*?)[_\s-]*((?:19|20)\d{2})$/
const YEAR_PREFIX = /^((?:19|20)\d{2})[_\s-]*(.*)$/

function splitYear(name: string): { base: string; year: string } | null {
  const suffix = YEAR_SUFFIX.exec(name)
  if (suffix?.[1] !== undefined && suffix[1] !== '' && suffix[2] !== undefined) return { base: suffix[1], year: suffix[2] }
  const prefix = YEAR_PREFIX.exec(name)
  if (prefix?.[2] !== undefined && prefix[2] !== '' && prefix[1] !== undefined) return { base: prefix[2], year: prefix[1] }
  return null
}

function joinWords(items: string[], last: string): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${last} ${items.at(-1) ?? ''}`
}

export interface ChartText {
  /** One-line chart title, e.g. "Revenue by territory, 2023 vs 2024". */
  title: string
  /** Legend names, one per measure. */
  series: string[]
  /** Title of the value axis, with its unit when all series share one; null when they do not. */
  valueTitle: string | null
  /** Title of the category or time axis. */
  dimensionTitle: string
  /** Format of each measure. */
  formats: ValueFormat[]
  /** Format of the value axis (the shared one, or a plain number format). */
  axisFormat: ValueFormat
}

const PLAIN: ValueFormat = { unit: 'none', scale: 1, decimals: 2, grouping: true }

function sameFormat(a: ValueFormat, b: ValueFormat): boolean {
  return a.unit === b.unit && a.scale === b.scale
}

/** Titles, legend names and formats derived from the result columns. */
export function chartText(spec: ChartSpec, columns: Column[], rows: unknown[][]): ChartText {
  const names = spec.measures.map((m) => columns[m]?.name ?? '')
  const dimensionName = columns[spec.dimension]?.name ?? ''
  const dimension = humanizeLower(dimensionName)
  const formats = spec.measures.map((m, i) => {
    const column = columns[m] ?? { name: names[i] ?? '', type: 'numeric' }
    return inferFormat(column, rows.map((r) => r[m]))
  })
  const [first] = formats
  const shared = first !== undefined && formats.every((f) => sameFormat(f, first)) ? first : null
  const axisFormat = shared ?? PLAIN

  const split = names.map(splitYear)
  const bases = new Set(split.map((s) => (s === null ? null : s.base.toLowerCase())))
  const byYear = names.length >= 2 && split.every((s) => s !== null) && bases.size === 1

  let title: string
  let series: string[]
  let valueName: string | null
  if (byYear) {
    const base = split[0]?.base ?? ''
    const years = split.map((s) => s?.year ?? '')
    title = `${humanize(base)} by ${dimension}, ${joinWords(years, 'vs')}`
    series = years
    valueName = humanize(base)
  } else {
    const words = names.map((n, i) => (i === 0 ? humanize(n) : humanizeLower(n)))
    title = `${joinWords(words, 'and')} by ${dimension}`
    series = names.map(humanize)
    valueName = names.length === 1 ? humanize(names[0] ?? '') : null
  }
  let valueTitle: string | null
  if (shared === null) valueTitle = null
  else if (valueName !== null) valueTitle = titleWithUnit(valueName, shared)
  else valueTitle = unitLabel(shared)

  return { title, series, valueTitle, dimensionTitle: humanize(dimensionName), formats, axisFormat }
}
