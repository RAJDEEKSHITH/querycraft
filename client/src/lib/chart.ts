import type { Column } from '../types/api'

// Chart rule (IMPLEMENTATION.md 15): one dimension column (text or date) plus 1–3
// numeric columns and at most 50 rows → date: line, text: bar; otherwise no chart.

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

export interface ChartSpec {
  kind: 'line' | 'bar'
  dimension: number
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

export function chooseChart(columns: Column[], rows: unknown[][]): ChartSpec | null {
  if (rows.length === 0 || rows.length > CHART_MAX_ROWS) return null
  const kinds = columns.map((c) => columnKind(c.type))
  const dimensions = kinds.flatMap((k, i) => (k === 'text' || k === 'date' ? [i] : []))
  const measures = kinds.flatMap((k, i) => (k === 'number' ? [i] : []))
  const [dimension] = dimensions
  if (dimension === undefined || dimensions.length !== 1) return null
  if (measures.length < 1 || measures.length > CHART_MAX_SERIES) return null
  if (dimensions.length + measures.length !== columns.length) return null
  // Every measure cell must be a number or SQL NULL.
  const numeric = rows.every((row) => measures.every((m) => row[m] === null || toNumber(row[m]) !== null))
  if (!numeric) return null
  return { kind: kinds[dimension] === 'date' ? 'line' : 'bar', dimension, measures }
}

export interface ChartPoint {
  label: string
  values: (number | null)[]
}

/** Points in display order: dates ascending, text in result order. */
export function chartPoints(spec: ChartSpec, rows: unknown[][]): ChartPoint[] {
  const points = rows.map((row) => ({
    label: row[spec.dimension] === null || row[spec.dimension] === undefined ? '(null)' : String(row[spec.dimension]),
    values: spec.measures.map((m) => toNumber(row[m])),
  }))
  if (spec.kind === 'line') points.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return points
}
