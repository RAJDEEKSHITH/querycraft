import { describe, expect, it } from 'vitest'
import { formatCount, formatFull, formatPlain, formatTick, humanize, inferFormat, titleWithUnit, type ValueFormat } from './units'

const col = (name: string, type = 'numeric') => ({ name, type })
const unit = (name: string, values: unknown[] = ['1'], type = 'numeric') => inferFormat(col(name, type), values).unit

const money: ValueFormat = { unit: 'currency', scale: 1, decimals: 2, grouping: true }
const pctPoints: ValueFormat = { unit: 'percent', scale: 1, decimals: 1, grouping: true }
const pctFraction: ValueFormat = { unit: 'percent', scale: 100, decimals: 1, grouping: true }
const count: ValueFormat = { unit: 'count', scale: 1, decimals: 0, grouping: true }

describe('humanize', () => {
  it('snake_case, camelCase and trailing years', () => {
    expect(humanize('revenue_2024')).toBe('Revenue 2024')
    expect(humanize('orders_together')).toBe('Orders together')
    expect(humanize('territory')).toBe('Territory')
    expect(humanize('TotalDue')).toBe('Total due')
    expect(humanize('revenue2024')).toBe('Revenue 2024')
    expect(humanize('product-name')).toBe('Product name')
  })

  it('AdventureWorks concatenated names and acronyms', () => {
    expect(humanize('totaldue')).toBe('Total due')
    expect(humanize('unitprice')).toBe('Unit price')
    expect(humanize('salesytd')).toBe('Sales YTD')
    expect(humanize('product_id')).toBe('Product ID')
    expect(humanize('growth_pct')).toBe('Growth percent')
  })

  it('falls back to the raw name when there are no words', () => {
    expect(humanize('?column?')).toBe('Column')
    expect(humanize('__')).toBe('__')
  })
})

describe('inferFormat: units from names', () => {
  it('money-like names → currency', () => {
    for (const name of ['revenue', 'revenue_2024', 'total_sales', 'subtotal', 'totaldue', 'total_due', 'unitprice', 'standardcost', 'freight', 'avg_spending', 'amount', 'linetotal']) {
      expect(unit(name), name).toBe('currency')
    }
  })

  it('percent / pct → percentage points', () => {
    expect(inferFormat(col('growth_pct'), ['12.5', '0.5'])).toEqual(pctPoints)
    expect(inferFormat(col('percent_change'), ['0.25'])).toEqual(pctPoints)
  })

  it('share / growth / rate → ×100 only when every value is between −1 and 1', () => {
    expect(inferFormat(col('share'), ['0.25', '-0.5', '1'])).toEqual(pctFraction)
    expect(inferFormat(col('growth'), ['0.1', '1.5'])).toEqual(pctPoints)
    expect(inferFormat(col('taxrate'), ['8.00', '14.00'])).toEqual(pctPoints)
    expect(inferFormat(col('conversion_rate', 'double precision'), [0.031])).toEqual(pctFraction)
  })

  it('exchange rates, currency and discounts → no unit', () => {
    for (const name of ['averagerate', 'endofdayrate', 'currency_rate', 'exchange_rate', 'unitpricediscount']) {
      expect(unit(name, ['0.9']), name).toBe('none')
    }
  })

  it('count-like names → count; the last word decides between count and money', () => {
    for (const name of ['count', 'order_count', 'number_of_orders', 'orderqty', 'quantity', 'units', 'orders', 'customers', 'orders_together', 'sales_count']) {
      expect(unit(name, ['3'], 'bigint'), name).toBe('count')
    }
    expect(unit('orders_revenue')).toBe('currency')
    expect(unit('revenue_per_customer')).toBe('currency')
  })

  it('counts: 0 decimals for whole values, 2 when values are fractional', () => {
    expect(inferFormat(col('orders', 'bigint'), ['3', '4'])).toEqual(count)
    expect(inferFormat(col('avg_orders'), ['3.47'])).toEqual({ ...count, decimals: 2 })
  })

  it('ids and whole years: no unit, no separators', () => {
    expect(inferFormat(col('productid', 'integer'), [707])).toEqual({ unit: 'none', scale: 1, decimals: 0, grouping: false })
    expect(inferFormat(col('customer_id', 'integer'), [11000]).grouping).toBe(false)
    expect(inferFormat(col('order_year'), ['2024'])).toEqual({ unit: 'none', scale: 1, decimals: 0, grouping: false })
    expect(unit('amount_paid')).toBe('currency')
  })

  it('unknown names → no unit; integer types 0 decimals, others 2', () => {
    expect(inferFormat(col('delta'), ['1.5'])).toEqual({ unit: 'none', scale: 1, decimals: 2, grouping: true })
    expect(inferFormat(col('n', 'integer'), [7])).toEqual({ unit: 'none', scale: 1, decimals: 0, grouping: true })
    expect(unit('weight')).toBe('none')
    expect(unit('total')).toBe('none')
  })
})

describe('number formatting', () => {
  it('full values: money 2 decimals, percent 1, counts 0, separators, no floating-point noise', () => {
    expect(formatFull(43671889.5037, money)).toBe('$43,671,889.50')
    expect(formatFull(1234567.891, money)).toBe('$1,234,567.89')
    expect(formatFull(-2000, money)).toBe('-$2,000.00')
    expect(formatFull(12.345, pctPoints)).toBe('12.3%')
    expect(formatFull(0.1234, pctFraction)).toBe('12.3%')
    expect(formatFull(19820, count)).toBe('19,820')
    expect(formatFull(0.1 + 0.2, money)).toBe('$0.30')
  })

  it('a negative that rounds to zero has no minus sign', () => {
    expect(formatFull(-0.001, money)).toBe('$0.00')
    expect(formatPlain(-0.004, money)).toBe('0.00')
  })

  it('plain values (table cells) carry no unit symbol', () => {
    expect(formatPlain(2217564.76, money)).toBe('2,217,564.76')
    expect(formatPlain(0.031, pctFraction)).toBe('3.1')
    expect(formatPlain(2024, { unit: 'none', scale: 1, decimals: 0, grouping: false })).toBe('2024')
  })

  it('axis ticks: compact from 10,000, decimals from the step', () => {
    const ticks = (values: number[], f: ValueFormat, step: number) => values.map((v) => formatTick(v, f, step, Math.max(...values.map(Math.abs))))
    expect(ticks([0, 500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000], money, 500_000)).toEqual(['$0', '$0.5M', '$1M', '$1.5M', '$2M', '$2.5M'])
    expect(ticks([0, 100_000, 200_000, 300_000, 400_000], money, 100_000)).toEqual(['$0', '$100K', '$200K', '$300K', '$400K'])
    expect(ticks([0, 1_000, 2_000, 5_000], money, 1_000)).toEqual(['$0', '$1,000', '$2,000', '$5,000'])
    expect(ticks([0, 0.1, 0.2, 0.3], pctFraction, 0.1)).toEqual(['0%', '10%', '20%', '30%'])
    expect(ticks([0, 2.5, 5, 7.5], pctPoints, 2.5)).toEqual(['0%', '2.5%', '5%', '7.5%'])
    expect(ticks([0, 5_000, 10_000, 20_000], count, 5_000)).toEqual(['0', '5K', '10K', '20K'])
    expect(ticks([-2_000_000_000, 0, 2_000_000_000], money, 2_000_000_000)).toEqual(['-$2B', '$0', '$2B'])
  })

  it('titles carry the unit', () => {
    expect(titleWithUnit('Revenue 2024', money)).toBe('Revenue 2024 (USD)')
    expect(titleWithUnit('Share', pctFraction)).toBe('Share (%)')
    expect(titleWithUnit('Growth percent', pctPoints)).toBe('Growth percent')
    expect(titleWithUnit('Orders', count)).toBe('Orders')
    expect(titleWithUnit('Orders', null)).toBe('Orders')
  })

  it('formatCount rounds and groups', () => {
    expect(formatCount(67938.7)).toBe('67,939')
    expect(formatCount(2228)).toBe('2,228')
  })
})
