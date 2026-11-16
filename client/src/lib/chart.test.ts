import { describe, expect, it } from 'vitest'
import { chartPoints, chooseChart, columnKind, toNumber } from './chart'

const text = (name: string) => ({ name, type: 'text' })
const varchar = (name: string) => ({ name, type: 'character varying' })
const date = (name: string) => ({ name, type: 'date' })
const ts = (name: string) => ({ name, type: 'timestamp without time zone' })
const num = (name: string) => ({ name, type: 'numeric' })
const big = (name: string) => ({ name, type: 'bigint' })

const rowsOf = (n: number, make: (i: number) => unknown[]): unknown[][] => Array.from({ length: n }, (_, i) => make(i))

describe('columnKind', () => {
  it('classifies the type names the server reports', () => {
    expect(columnKind('integer')).toBe('number')
    expect(columnKind('double precision')).toBe('number')
    expect(columnKind('numeric(12,2)')).toBe('number')
    expect(columnKind('character varying(50)')).toBe('text')
    expect(columnKind('timestamp with time zone')).toBe('date')
    expect(columnKind('boolean')).toBe('other')
    expect(columnKind('money')).toBe('other')
    expect(columnKind('unknown')).toBe('other')
  })
})

describe('chooseChart', () => {
  it('text dimension + one numeric column → bar', () => {
    expect(chooseChart([text('territory'), num('revenue')], [['Northwest', '123.45']])).toEqual({ kind: 'bar', dimension: 0, measures: [1] })
  })

  it('date dimension → line, whatever the column order', () => {
    expect(chooseChart([num('revenue'), date('month')], [['1', '2024-01-01']])).toEqual({ kind: 'line', dimension: 1, measures: [0] })
    expect(chooseChart([ts('month'), num('revenue')], [['2024-01-01 00:00:00', 5]])?.kind).toBe('line')
  })

  it('allows up to 3 numeric columns', () => {
    const cols = [varchar('territory'), num('a'), big('b'), num('c')]
    expect(chooseChart(cols, [['x', 1, '2', 3]])).toEqual({ kind: 'bar', dimension: 0, measures: [1, 2, 3] })
  })

  it('no chart with 4 numeric columns', () => {
    expect(chooseChart([text('t'), num('a'), num('b'), num('c'), num('d')], [['x', 1, 2, 3, 4]])).toBeNull()
  })

  it('no chart without a numeric column', () => {
    expect(chooseChart([text('name')], [['a']])).toBeNull()
  })

  it('no chart with two dimension columns', () => {
    expect(chooseChart([text('a'), date('b'), num('n')], [['x', '2024-01-01', 1]])).toBeNull()
    expect(chooseChart([text('a'), text('b'), num('n')], [['x', 'y', 1]])).toBeNull()
  })

  it('no chart without a dimension (numeric year from extract)', () => {
    expect(chooseChart([num('year'), num('revenue')], [['2024', '1']])).toBeNull()
  })

  it('no chart when another column type is present', () => {
    expect(chooseChart([text('t'), num('n'), { name: 'flag', type: 'boolean' }], [['x', 1, true]])).toBeNull()
  })

  it('50 rows is the maximum; 51 rows or none → no chart', () => {
    const cols = [text('t'), num('n')]
    expect(chooseChart(cols, rowsOf(50, (i) => [`r${i}`, i]))).not.toBeNull()
    expect(chooseChart(cols, rowsOf(51, (i) => [`r${i}`, i]))).toBeNull()
    expect(chooseChart(cols, [])).toBeNull()
  })

  it('NULL measures are allowed; non-numeric measure values are not', () => {
    const cols = [text('t'), num('n')]
    expect(chooseChart(cols, [['a', null], ['b', '2']])).not.toBeNull()
    expect(chooseChart(cols, [['a', 'NaN']])).toBeNull()
    expect(chooseChart(cols, [['a', 'abc']])).toBeNull()
  })
})

describe('toNumber and chartPoints', () => {
  it('parses numbers and numeric strings only', () => {
    expect(toNumber(3)).toBe(3)
    expect(toNumber('12.50')).toBe(12.5)
    expect(toNumber('')).toBeNull()
    expect(toNumber(null)).toBeNull()
    expect(toNumber(Infinity)).toBeNull()
  })

  it('sorts line points by date and keeps bar order', () => {
    const line = chartPoints({ kind: 'line', dimension: 0, measures: [1] }, [
      ['2024-03-01', '3'],
      ['2024-01-01', '1'],
    ])
    expect(line.map((p) => p.label)).toEqual(['2024-01-01', '2024-03-01'])
    const bar = chartPoints({ kind: 'bar', dimension: 0, measures: [1] }, [
      ['b', 2],
      ['a', null],
    ])
    expect(bar).toEqual([
      { label: 'b', values: [2] },
      { label: 'a', values: [null] },
    ])
  })
})
