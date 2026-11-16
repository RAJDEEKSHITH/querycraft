import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import { ResultTable } from './ResultTable'
import { ResultView } from './ResultView'

// Regression for the 2026-11-16 blank page ("formatCell is not defined" in ResultTable
// when an answer with rows arrived): render the table with real-shaped rows.

describe('ResultTable with real rows', () => {
  it('moment 1 shape: one bigint count (int8 arrives as a string)', () => {
    const out = renderToStaticMarkup(<ResultTable columns={[{ name: 'customer_count', type: 'bigint' }]} rows={[['19820']]} truncated={false} />)
    expect(out).toContain('19,820')
    expect(out).toContain('1 row')
  })

  it('moment 7 shape: two text columns and a count, paged at 25 rows, NULLs shown', () => {
    const rows: unknown[][] = Array.from({ length: 30 }, (_, i) => [`Product ${i}`, i === 3 ? null : `Partner ${i}`, String(2000 - i)])
    const out = renderToStaticMarkup(
      <ResultTable
        columns={[
          { name: 'product_a', type: 'text' },
          { name: 'product_b', type: 'text' },
          { name: 'orders_together', type: 'bigint' },
        ]}
        rows={rows}
        truncated={false}
      />,
    )
    expect(out).toContain('Product 0')
    expect(out).toContain('2,000')
    expect(out).toContain('NULL')
    expect(out).toContain('Page 1 of 2')
    expect(out).not.toContain('Product 25')
  })

  it('numeric money, dates and a truncation notice', () => {
    const out = renderToStaticMarkup(
      <ResultTable
        columns={[
          { name: 'month', type: 'timestamp without time zone' },
          { name: 'revenue', type: 'numeric' },
        ]}
        rows={[['2024-01-01 00:00:00', '2217564.7600']]}
        truncated
      />,
    )
    expect(out).toContain('2024-01-01 00:00:00')
    expect(out).toContain('2,217,564.76')
    expect(out).toContain('cut at the row limit')
  })

  it('ResultView renders the same rows inside its error boundary', () => {
    const out = renderToStaticMarkup(
      <ResultView columns={[{ name: 'name', type: 'text' }, { name: 'revenue', type: 'numeric' }]} rows={[['Mountain-200 Black, 38', '2217564.76']]} truncated={false} />,
    )
    expect(out).toContain('<table')
    expect(out).toContain('2,217,564.76')
  })
})

describe('ErrorBoundary', () => {
  it('a render error switches it to the app error state with a retry', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true })
    const boundary = new ErrorBoundary({ label: 'the result', children: <p>rows</p> })
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe('<p>rows</p>')
    boundary.state = ErrorBoundary.getDerivedStateFromError()
    const out = renderToStaticMarkup(<>{boundary.render()}</>)
    expect(out).toContain('role="alert"')
    expect(out).toContain('Something went wrong while showing the result.')
    expect(out).toContain('Try again')
  })
})
