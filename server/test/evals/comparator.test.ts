import { describe, expect, it } from 'vitest'
import { compareResults, normalizeValue, type ComparableResult } from '../../evals/comparator.js'

// Execution-accuracy comparator (IMPLEMENTATION.md 20.3).

function result(rows: unknown[][], columnCount = rows[0]?.length ?? 1): ComparableResult {
  return { columnCount, rows }
}

const unordered = { orderMatters: false }
const ordered = { orderMatters: true }

describe('normalizeValue', () => {
  it.each([
    [504, 504],
    ['504', 504],
    ['504.00', 504],
    ['3578.2700', 3578.27],
    ['45.1213592233009709', 45.12],
    [45.126, 45.13],
    ['-26.2080686244214695', -26.21],
    ['1e3', 1000],
    ['-0.001', 0],
    [12n, 12],
  ])('rounds numbers to 2 decimals: %s → %s', (input, expected) => {
    expect(normalizeValue(input)).toBe(expected)
  })

  it('treats a midnight timestamp as its date and keeps other times', () => {
    expect(normalizeValue('2024-01-01 00:00:00')).toBe('2024-01-01')
    expect(normalizeValue('2024-01-01')).toBe('2024-01-01')
    expect(normalizeValue('2024-01-01 08:00:00')).toBe('2024-01-01 08:00:00')
  })

  it('keeps other text exactly, including case and spacing', () => {
    expect(normalizeValue('Bikes')).toBe('Bikes')
    expect(normalizeValue('bikes')).toBe('bikes')
    expect(normalizeValue(' Bikes ')).toBe(' Bikes ')
    expect(normalizeValue('12 units')).toBe('12 units')
    expect(normalizeValue('NaN')).toBe('NaN')
  })

  it('normalizes nulls, booleans, dates, arrays and objects', () => {
    expect(normalizeValue(null)).toBeNull()
    expect(normalizeValue(undefined)).toBeNull()
    expect(normalizeValue(true)).toBe(true)
    expect(normalizeValue(new Date('2024-01-01T00:00:00Z'))).toBe('2024-01-01T00:00:00.000Z')
    expect(normalizeValue(['1.004', '2024-02-01 00:00:00'])).toEqual([1, '2024-02-01'])
    expect(JSON.stringify(normalizeValue({ b: '2.001', a: 1 }))).toBe('{"a":1,"b":2}')
  })
})

describe('compareResults', () => {
  it('matches identical results', () => {
    expect(compareResults(result([['Bikes', '1586.74']]), result([['Bikes', '1586.74']]), unordered)).toEqual({ match: true })
  })

  it('ignores column names (only values are compared)', () => {
    // Names are not part of the input at all; the same rows under any alias match.
    expect(compareResults(result([['504']]), result([[504]]), unordered)).toEqual({ match: true })
  })

  it('requires the same column count', () => {
    expect(compareResults(result([['Bikes', 1]]), result([['Bikes', 1, 'extra']]), unordered)).toEqual({
      match: false,
      reason: 'column_count',
      gold: 2,
      generated: 3,
    })
  })

  it('compares column counts even when there are no rows', () => {
    expect(compareResults(result([], 2), result([], 2), unordered)).toEqual({ match: true })
    expect(compareResults(result([], 2), result([], 1), unordered)).toMatchObject({ match: false, reason: 'column_count' })
  })

  it('reports a different row count', () => {
    expect(compareResults(result([[1], [2]]), result([[1]]), unordered)).toEqual({
      match: false,
      reason: 'row_count',
      gold: 2,
      generated: 1,
    })
  })

  it('compares rows as multisets when order does not matter', () => {
    const gold = result([['Europe', '8514'], ['Pacific', '6843'], ['North America', '16108']])
    const generated = result([['North America', 16108], ['Europe', 8514], ['Pacific', 6843]])
    expect(compareResults(gold, generated, unordered)).toEqual({ match: true })
  })

  it('counts duplicate rows (multiset, not set)', () => {
    expect(compareResults(result([['a'], ['a'], ['b']]), result([['a'], ['b'], ['b']]), unordered)).toEqual({
      match: false,
      reason: 'rows',
    })
  })

  it('requires the same order when order matters', () => {
    const gold = result([['a', 1], ['b', 2]])
    expect(compareResults(gold, result([['a', 1], ['b', 2]]), ordered)).toEqual({ match: true })
    expect(compareResults(gold, result([['b', 2], ['a', 1]]), ordered)).toEqual({ match: false, reason: 'rows' })
  })

  it('keeps column order within a row', () => {
    expect(compareResults(result([['Bikes', 4]]), result([[4, 'Bikes']]), unordered)).toEqual({ match: false, reason: 'rows' })
  })

  it('rounds numbers to 2 decimals before comparing', () => {
    expect(compareResults(result([['24.6875917266793760']]), result([[24.68759]]), unordered)).toEqual({ match: true })
    expect(compareResults(result([['24.68']]), result([[24.69]]), unordered)).toEqual({ match: false, reason: 'rows' })
  })

  it('treats date_trunc output and a date cast as the same month', () => {
    expect(compareResults(result([['2024-01-01 00:00:00', '12.23']]), result([['2024-01-01', '12.2319']]), unordered)).toEqual({
      match: true,
    })
  })

  it('treats null as a value', () => {
    expect(compareResults(result([[null, 1]]), result([[null, 1]]), unordered)).toEqual({ match: true })
    expect(compareResults(result([[null]]), result([[0]]), unordered)).toEqual({ match: false, reason: 'rows' })
  })
})
