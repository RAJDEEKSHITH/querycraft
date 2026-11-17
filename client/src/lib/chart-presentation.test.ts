import { describe, expect, it } from 'vitest'
import { barOrientation, chartPoints, chartText, chooseChart, dateLabels, isYearColumn, truncateLabel } from './chart'

// Year dimension, date labels, orientation and chart titles (IMPLEMENTATION.md 15,
// "Chart presentation", approved 2026-11-17).

const text = (name: string) => ({ name, type: 'text' })
const date = (name: string) => ({ name, type: 'date' })
const num = (name: string) => ({ name, type: 'numeric' })
const big = (name: string) => ({ name, type: 'bigint' })

const years = (n: number, from = 2022): unknown[][] => Array.from({ length: n }, (_, i) => [String(from + i), String(1000 * (i + 1))])

describe('year dimension', () => {
  it('a numeric year column is the dimension: line for 3+ years, bars for fewer', () => {
    expect(chooseChart([num('year'), num('revenue')], years(4))).toEqual({ kind: 'line', dimension: 0, dimensionKind: 'year', measures: [1] })
    expect(chooseChart([num('year'), num('revenue')], years(3))?.kind).toBe('line')
    expect(chooseChart([num('order_year'), num('revenue')], years(2))).toEqual({ kind: 'bar', dimension: 0, dimensionKind: 'year', measures: [1] })
    expect(chooseChart([{ name: 'fiscal_year', type: 'integer' }, big('orders')], [[2024, '5']])?.dimensionKind).toBe('year')
    // Column order does not matter.
    expect(chooseChart([num('revenue'), num('year')], years(1).map((r) => [r[1], r[0]]))).toEqual({
      kind: 'bar',
      dimension: 1,
      dimensionKind: 'year',
      measures: [0],
    })
  })

  it('names: "year" or ending in "year" only', () => {
    expect(isYearColumn('year', [['2024']], 0)).toBe(true)
    expect(isYearColumn('orderYear', [['2024']], 0)).toBe(true)
    expect(isYearColumn('year_total', [['2024']], 0)).toBe(false)
    expect(isYearColumn('yearly', [['2024']], 0)).toBe(false)
  })

  it('values: whole numbers 1900–2100 and no NULLs', () => {
    expect(isYearColumn('year', [['1900'], ['2100']], 0)).toBe(true)
    expect(isYearColumn('year', [['1899']], 0)).toBe(false)
    expect(isYearColumn('year', [['2101']], 0)).toBe(false)
    expect(isYearColumn('year', [['2024.5']], 0)).toBe(false)
    expect(isYearColumn('year', [[null]], 0)).toBe(false)
  })

  it('money in a "…year" column stays a measure', () => {
    expect(isYearColumn('saleslastyear', [['3298694.4938']], 0)).toBe(false)
    expect(chooseChart([text('territory'), num('saleslastyear')], [['Northwest', '3298694.4938']])?.dimensionKind).toBe('text')
  })

  it('a text column plus a year column are two dimensions → no chart', () => {
    expect(chooseChart([text('territory'), num('year'), num('revenue')], [['Northwest', '2024', '1']])).toBeNull()
  })

  it('year points are sorted ascending and labelled without decimals', () => {
    const rows = [['2024', '3'], ['2022', '1'], ['2023', '2']]
    const spec = chooseChart([num('year'), num('revenue')], rows)
    if (spec === null) throw new Error('expected a chart')
    expect(chartPoints(spec, rows).map((p) => p.label)).toEqual(['2022', '2023', '2024'])
    expect(chartPoints(spec, [['2024.000', '3']]).map((p) => p.label)).toEqual(['2024'])
  })
})

describe('dateLabels', () => {
  it('1 January everywhere → years', () => {
    expect(dateLabels(['2023-01-01', '2024-01-01 00:00:00'])).toEqual(['2023', '2024'])
  })

  it('the 1st of the month everywhere → "Jan 2024"', () => {
    expect(dateLabels(['2024-01-01 00:00:00', '2024-02-01 00:00:00', '2024-12-01'])).toEqual(['Jan 2024', 'Feb 2024', 'Dec 2024'])
    expect(dateLabels(['2024-03-01T00:00:00.000Z'])).toEqual(['Mar 2024'])
  })

  it('other days → "5 Jan 2024", with the time only when one is set', () => {
    expect(dateLabels(['2024-01-05', '2024-02-01'])).toEqual(['5 Jan 2024', '1 Feb 2024'])
    expect(dateLabels(['2024-01-05 14:30:00', '2024-01-05 00:00:00'])).toEqual(['5 Jan 2024 14:30', '5 Jan 2024'])
  })

  it('anything that is not a date is left as it is', () => {
    expect(dateLabels(['2024-01-01', 'soon'])).toEqual(['2024-01-01', 'soon'])
  })
})

describe('barOrientation and truncateLabel', () => {
  const labels = (n: number, len = 6): string[] => Array.from({ length: n }, (_, i) => `${'x'.repeat(len - 1)}${i % 10}`)

  it('up to 8 short labels that fit under their bars → vertical', () => {
    expect(barOrientation(labels(8), 600)).toBe('vertical')
    expect(barOrientation(['2023', '2024'], 300)).toBe('vertical')
  })

  it('more than 8 categories → horizontal', () => {
    expect(barOrientation(labels(9), 2000)).toBe('horizontal')
  })

  it('a label longer than 16 characters → horizontal', () => {
    expect(barOrientation(['Mountain-200 Black, 38', 'Short'], 2000)).toBe('horizontal')
  })

  it('labels wider than their band (narrow screens) → horizontal', () => {
    // 6 labels of 12 characters need about 92 px each; 300 px gives 50 per band.
    expect(barOrientation(labels(6, 12), 300)).toBe('horizontal')
    expect(barOrientation(labels(6, 12), 900)).toBe('vertical')
  })

  it('truncates with an ellipsis', () => {
    expect(truncateLabel('Mountain-200 Black, 38', 10)).toBe('Mountain-…')
    expect(truncateLabel('Short', 10)).toBe('Short')
  })
})

describe('chartText', () => {
  it('year-suffixed measures → "Revenue by territory, 2023 vs 2024", legend by year', () => {
    const columns = [text('territory'), num('revenue_2023'), num('revenue_2024')]
    const rows = [['Northwest', '1.5', '2.5']]
    const spec = chooseChart(columns, rows)
    if (spec === null) throw new Error('expected a chart')
    const t = chartText(spec, columns, rows)
    expect(t.title).toBe('Revenue by territory, 2023 vs 2024')
    expect(t.series).toEqual(['2023', '2024'])
    expect(t.valueTitle).toBe('Revenue (USD)')
    expect(t.dimensionTitle).toBe('Territory')
    expect(t.axisFormat.unit).toBe('currency')
  })

  it('one count measure → title, axis title without a unit', () => {
    const columns = [text('product_pair'), big('orders_together')]
    const rows = [['A + B', '12']]
    const spec = chooseChart(columns, rows)
    if (spec === null) throw new Error('expected a chart')
    const t = chartText(spec, columns, rows)
    expect(t.title).toBe('Orders together by product pair')
    expect(t.series).toEqual(['Orders together'])
    expect(t.valueTitle).toBe('Orders together')
    expect(t.formats[0]?.unit).toBe('count')
  })

  it('different units → no shared value title; names joined with "and"', () => {
    const columns = [text('territory'), num('revenue'), big('order_count')]
    const rows = [['Northwest', '10.5', '3']]
    const spec = chooseChart(columns, rows)
    if (spec === null) throw new Error('expected a chart')
    const t = chartText(spec, columns, rows)
    expect(t.title).toBe('Revenue and order count by territory')
    expect(t.series).toEqual(['Revenue', 'Order count'])
    expect(t.valueTitle).toBeNull()
    expect(t.axisFormat.unit).toBe('none')
  })

  it('same unit, different names → the unit alone as the value title', () => {
    const columns = [text('territory'), num('revenue'), num('freight')]
    const rows = [['Northwest', '10.5', '3']]
    const spec = chooseChart(columns, rows)
    if (spec === null) throw new Error('expected a chart')
    const t = chartText(spec, columns, rows)
    expect(t.title).toBe('Revenue and freight by territory')
    expect(t.valueTitle).toBe('USD')
  })

  it('three year-prefixed measures and a date dimension', () => {
    const columns = [date('month'), num('2022_sales'), num('2023_sales'), num('2024_sales')]
    const rows = [['2024-01-01', '1', '2', '3']]
    const spec = chooseChart(columns, rows)
    if (spec === null) throw new Error('expected a chart')
    expect(chartText(spec, columns, rows).title).toBe('Sales by month, 2022, 2023 vs 2024')
  })
})
