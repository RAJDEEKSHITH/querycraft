import { describe, expect, it } from 'vitest'
import { formatResultCell } from './format'

const col = (name: string, type: string) => ({ name, type })

describe('formatResultCell', () => {
  it('decimal types: thousands separators and exactly 2 decimals', () => {
    expect(formatResultCell('2217564.7600', col('revenue', 'numeric'))).toBe('2,217,564.76')
    expect(formatResultCell('1234.5', col('revenue', 'numeric'))).toBe('1,234.50')
    expect(formatResultCell('0.005', col('weight', 'double precision'))).toBe('0.01')
    // A "rate" of fractions is a percentage since 2026-11-17 (approved unit rules): 0.5 (%).
    expect(formatResultCell(0.005, col('rate', 'double precision'))).toBe('0.5')
    expect(formatResultCell('-12', col('delta', 'numeric(12,2)'))).toBe('-12.00')
  })

  it('integer types: thousands separators, no decimals', () => {
    expect(formatResultCell('19820', col('count', 'bigint'))).toBe('19,820')
    expect(formatResultCell(7, col('n', 'integer'))).toBe('7')
  })

  it('whole numbers in date-part columns stay as they are', () => {
    expect(formatResultCell('2024', col('year', 'numeric'))).toBe('2024')
    expect(formatResultCell('2024', col('order_year', 'numeric'))).toBe('2024')
    expect(formatResultCell('10', col('month', 'numeric'))).toBe('10')
    expect(formatResultCell(2024, col('fiscal_year', 'integer'))).toBe('2024')
    expect(formatResultCell('2024.5', col('year', 'numeric'))).toBe('2,024.50')
  })

  it('other types and unusable values are shown raw', () => {
    expect(formatResultCell('2024-01-01', col('d', 'date'))).toBe('2024-01-01')
    expect(formatResultCell('Northwest', col('name', 'text'))).toBe('Northwest')
    expect(formatResultCell('NaN', col('x', 'numeric'))).toBe('NaN')
    expect(formatResultCell('123456789012345678901', col('big', 'numeric'))).toBe('123456789012345678901')
    expect(formatResultCell(true, col('flag', 'boolean'))).toBe('true')
  })
})
