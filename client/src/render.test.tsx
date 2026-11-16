import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultView } from './components/ResultView'
import { AdminView } from './features/admin/AdminView'
import { AskView } from './features/ask/AskView'
import { TurnCard } from './features/ask/TurnCard'
import { HistoryView } from './features/history/HistoryView'
import { QuestionDetails } from './features/history/QuestionDetails'
import type { Turn } from './stores/ask-reducer'
import type { AnswerData, QuestionView } from './types/api'

// Render smoke tests: every view and every Ask card state renders without throwing
// and shows its key text (server-side rendering in Node; no DOM library needed).

const answer: AnswerData = {
  answer: 'Mountain-200 Black, 38 had the highest revenue.',
  explanation: 'Summed order-line revenue for 2024.',
  sql: 'SELECT p.name, sum(sod.orderqty) FROM sales.salesorderdetail sod JOIN production.product p ON p.productid = sod.productid GROUP BY 1',
  tablesUsed: ['sales.salesorderdetail', 'production.product'],
  assumptions: ['Revenue = order-line revenue after discount'],
  columns: [
    { name: 'product', type: 'text' },
    { name: 'revenue', type: 'numeric' },
  ],
  rows: [
    ['Mountain-200 Black, 38', '1234.5'],
    ['Road-150 Red, 62', '999'],
  ],
  rowCount: 2,
  truncated: false,
  tokens: { prompt: 2000, completion: 300, embedding: 0 },
  latencyMs: 4200,
}

const base: Turn = {
  questionId: 'q1',
  question: 'Top 5 products by revenue in 2024.',
  status: 'running',
  streaming: true,
  steps: [
    { node: 'generate', status: 'completed', detail: { action: 'sql', attempt: 1 } },
    { node: 'execute', status: 'completed', detail: { rowCount: 0, truncated: false } },
    { node: 'generate', status: 'completed', detail: { action: 'sql', attempt: 2 } },
    { node: 'execute', status: 'started', detail: null },
  ],
  segmentStart: 0,
  clarification: null,
  approval: null,
  outcome: null,
  rerunRows: null,
  feedback: null,
}

const html = (turn: Partial<Turn>): string => renderToStaticMarkup(<TurnCard turn={{ ...base, ...turn }} />)

describe('views render', () => {
  it('Ask view shows the suggested demo questions and the input', () => {
    const out = renderToStaticMarkup(<AskView />)
    expect(out).toContain('Top 5 products by revenue in 2014.')
    expect(out).toContain('How did sales change between the two periods?')
    expect(out).toContain('0 / 500')
  })

  it('History view without conversations shows its empty state', () => {
    expect(renderToStaticMarkup(<HistoryView />)).toContain('No conversations yet')
  })

  it('Admin view asks for the token first', () => {
    const out = renderToStaticMarkup(<AdminView />)
    expect(out).toContain('Admin token')
    expect(out).toContain('type="password"')
  })
})

describe('Ask turn states render', () => {
  it('live steps show the self-correction attempt', () => {
    const out = html({})
    expect(out).toContain('attempt 2 (self-correction)')
    expect(out).toContain('0 rows')
  })

  it('clarification card with options and free text', () => {
    const out = html({ status: 'awaiting_clarification', streaming: false, clarification: { question: 'Which year?', options: ['2024', '2025'] } })
    expect(out).toContain('Which year?')
    expect(out).toContain('2025')
    expect(out).toContain('Or answer in your own words')
  })

  it('approval card with cost vs soft limit and the SQL', () => {
    const out = html({ status: 'awaiting_approval', streaming: false, approval: { estimatedCost: 67939, softLimit: 50000, sql: 'SELECT 1' } })
    expect(out).toContain('67,939')
    expect(out).toContain('50,000')
    expect(out).toContain('Approve')
    expect(out).toContain('Deny')
  })

  it('answer with assumptions, tables, SQL, chart, table and feedback', () => {
    const out = html({ status: 'answered', streaming: false, outcome: { kind: 'answer', data: answer } })
    expect(out).toContain('Mountain-200 Black, 38 had the highest revenue.')
    expect(out).toContain('Assumptions')
    expect(out).toContain('production.product')
    expect(out).toContain('Copy')
    expect(out).toContain('<svg')
    expect(out).toContain('<table')
    expect(out).toContain('Helpful')
    // Display formatting of the numeric revenue column.
    expect(out).toContain('1,234.50')
    expect(out).toContain('999.00')
  })

  it('stored answer without rows offers a re-run', () => {
    const out = html({ status: 'answered', streaming: false, outcome: { kind: 'answer', data: { ...answer, rows: null } } })
    expect(out).toContain('Re-run query')
  })

  it('blocked card shows layer and rule; refusal and denial have their messages', () => {
    const blocked = html({
      status: 'blocked',
      streaming: false,
      outcome: { kind: 'blocked', data: { stage: 'validation', rule: 'COLUMN_DENIED', message: 'humanresources.employee.nationalidnumber is denied' } },
    })
    expect(blocked).toContain('SQL policy (parser)')
    expect(blocked).toContain('COLUMN_DENIED')
    expect(html({ status: 'cannot_answer', streaming: false, outcome: { kind: 'cannot_answer', reason: 'Not a read question' } })).toContain(
      'Not a read question',
    )
    expect(html({ status: 'cancelled', streaming: false })).toContain('You denied the expensive query')
  })

  it('a lost stream offers a reconnect', () => {
    const out = html({ streaming: false, outcome: { kind: 'error', code: 'STREAM_LOST', message: 'Lost the live connection to the server.' } })
    expect(out).toContain('Reconnect')
  })
})

describe('result and history details render', () => {
  it('no chart when chooseChart says no; the table still shows', () => {
    const out = renderToStaticMarkup(
      <ResultView columns={[{ name: 'year', type: 'numeric' }, { name: 'revenue', type: 'numeric' }]} rows={[['2024', '1']]} truncated />,
    )
    expect(out).not.toContain('<svg')
    expect(out).toContain('cut at the row limit')
  })

  it('a line chart for a date dimension', () => {
    const out = renderToStaticMarkup(
      <ResultView columns={[{ name: 'month', type: 'timestamp without time zone' }, { name: 'revenue', type: 'numeric' }]} rows={[['2024-01-01 00:00:00', '5'], ['2024-02-01 00:00:00', '7']]} truncated={false} />,
    )
    expect(out).toContain('<polyline')
  })

  it('history question details show answer, SQL, steps and re-run', () => {
    const q: QuestionView = {
      id: 'q1',
      conversationId: 'c1',
      question: 'How many customers do we have?',
      status: 'answered',
      sql: 'SELECT count(*) FROM sales.customer',
      answer: 'There are 19,820 customers.',
      explanation: null,
      tablesUsed: ['sales.customer'],
      assumptions: [],
      columns: [{ name: 'count', type: 'bigint' }],
      rowCount: 1,
      truncated: false,
      attempts: 1,
      trace: [{ node: 'execute', startedAt: '2026-11-16T10:00:00.000Z', durationMs: 12, detail: { rowCount: 1, truncated: false } }],
      errorCode: null,
      tokens: { prompt: 1, completion: 1, embedding: 0 },
      costUsd: '0',
      latencyMs: 1000,
      createdAt: '2026-11-16T10:00:00.000Z',
      completedAt: '2026-11-16T10:00:01.000Z',
      clarification: null,
      approval: null,
      reason: null,
      blocked: null,
      error: null,
    }
    const out = renderToStaticMarkup(<QuestionDetails question={q} />)
    expect(out).toContain('There are 19,820 customers.')
    expect(out).toContain('Re-run query')
    expect(out).toContain('12 ms')
  })
})
