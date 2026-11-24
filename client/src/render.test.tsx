import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultView } from './components/ResultView'
import { AdminView } from './features/admin/AdminView'
import { ChatView } from './features/ask/ChatView'
import { Composer } from './features/ask/Composer'
import { EmptyThread } from './features/ask/EmptyThread'
import { ThreadTurn } from './features/ask/ThreadTurn'
import { ConversationRow } from './features/sidebar/ConversationRow'
import { Sidebar } from './features/sidebar/Sidebar'
import { turnFromRecord, type Turn } from './stores/ask-reducer'
import type { AnswerData, QuestionView } from './types/api'

// Render smoke tests: every view and every thread state renders without throwing and shows
// its key text (server-side rendering in Node; no DOM library needed).

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
  detached: false,
  steps: [
    { node: 'generate', status: 'completed', detail: { action: 'sql', attempt: 1 }, durationMs: null },
    { node: 'execute', status: 'completed', detail: { rowCount: 0, truncated: false }, durationMs: null },
    { node: 'generate', status: 'completed', detail: { action: 'sql', attempt: 2 }, durationMs: null },
    { node: 'execute', status: 'started', detail: null, durationMs: null },
  ],
  segmentStart: 0,
  clarification: null,
  approval: null,
  exchanges: [],
  outcome: null,
  rerunRows: null,
  feedback: null,
  latencyMs: null,
}

const html = (turn: Partial<Turn>): string => renderToStaticMarkup(<ThreadTurn turn={{ ...base, ...turn }} />)
const finished = { streaming: false }

describe('views render', () => {
  it('a new conversation shows the heading, the demo cards and the composer', () => {
    const out = renderToStaticMarkup(<ChatView conversationId={null} />)
    expect(out).toContain('Ask your database anything')
    expect(out).toContain('Which 5 salespeople had the highest sales in 2024?')
    expect(out).toContain('How did sales change between the two periods?')
    expect(out).toContain('Read-only. Every query is checked and audited.')
    expect(out).toContain('Sales data covers May 2022 - June 2025.')
    expect(out).toContain('A multi-table join')
    expect(out).toContain('Send question')
  })

  it('empty thread cards say what each question shows', () => {
    const out = renderToStaticMarkup(<EmptyThread disabled={false} onPick={() => undefined} />)
    expect(out).toContain('A clarifying question')
    expect(out).toContain('Approval of an expensive query')
  })

  it('the composer hides the counter far from the limit', () => {
    const out = renderToStaticMarkup(<Composer />)
    expect(out).not.toContain('/ 500')
    expect(out).toContain('Ask a question about the AdventureWorks database')
  })

  it('sidebar without conversations: new conversation, empty list, Admin link and theme toggle', () => {
    const out = renderToStaticMarkup(<Sidebar activeId={null} adminActive={false} />)
    expect(out).toContain('New conversation')
    expect(out).toContain('No conversations yet')
    expect(out).toContain('href="#/admin"')
    expect(out).toContain('Dark theme')
    expect(out).toContain('aria-keyshortcuts')
  })

  it('a sidebar row links to its conversation; the active one is marked; an unknown title shows a skeleton', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const row = renderToStaticMarkup(<ConversationRow entry={{ id, title: 'How many customers do we have?', updatedAt: null }} active />)
    expect(row).toContain(`href="#/c/${id}"`)
    expect(row).toContain('aria-current="page"')
    expect(row).toContain('Options for How many customers do we have?')
    expect(renderToStaticMarkup(<ConversationRow entry={{ id, title: null, updatedAt: null }} active={false} />)).toContain('Loading the title')
  })

  it('Admin view asks for the token first', () => {
    const out = renderToStaticMarkup(<AdminView />)
    expect(out).toContain('Admin token')
    expect(out).toContain('type="password"')
  })
})

describe('thread turn states render', () => {
  it('the user message, then the live timeline with present-tense labels and the self-correction attempt', () => {
    const out = html({})
    expect(out).toContain('Top 5 products by revenue in 2024.')
    expect(out).toContain('attempt 2 (self-correction)')
    expect(out).toContain('0 rows')
    expect(out).toContain('Running the query…')
    expect(out).toContain('Waiting for the answer')
  })

  it('a finished timeline collapses into one summary line', () => {
    const out = html({ ...finished, status: 'answered', latencyMs: 3200, outcome: { kind: 'answer', data: answer } })
    expect(out).toContain('3 steps · 2 attempts · 3.2 s')
    expect(out).toContain('aria-expanded="false"')
  })

  it('clarification inline with options and free text; an answered one stays in the thread', () => {
    const out = html({ ...finished, status: 'awaiting_clarification', clarification: { question: 'Which year?', options: ['2024', '2025'] } })
    expect(out).toContain('aria-label="Clarification needed"')
    expect(out).toContain('Which year?')
    expect(out).toContain('2025')
    expect(out).toContain('Or answer in your own words')
    const answered = html({ exchanges: [{ kind: 'clarification', question: 'Which year?', answer: '2024' }] })
    expect(answered).toContain('You chose: 2024')
  })

  it('approval inline with cost vs soft limit and the SQL', () => {
    const out = html({ ...finished, status: 'awaiting_approval', approval: { estimatedCost: 67939, softLimit: 50000, sql: 'SELECT 1' } })
    expect(out).toContain('aria-label="Approval needed"')
    expect(out).toContain('67,939')
    expect(out).toContain('50,000')
    expect(out).toContain('Approve')
    expect(out).toContain('Deny')
    expect(html({ exchanges: [{ kind: 'approval', estimatedCost: 67939, approved: true }] })).toContain('you approved it')
  })

  it('answer first, then chart and table, details with SQL, tables and assumptions, and feedback', () => {
    const out = html({ ...finished, status: 'answered', outcome: { kind: 'answer', data: answer } })
    expect(out.indexOf('Mountain-200 Black, 38 had the highest revenue.')).toBeLessThan(out.indexOf('aria-roledescription="chart"'))
    expect(out.indexOf('aria-roledescription="chart"')).toBeGreaterThan(-1)
    expect(out.indexOf('aria-roledescription="chart"')).toBeLessThan(out.indexOf('<table'))
    expect(out.indexOf('<table')).toBeLessThan(out.indexOf('Details'))
    expect(out).toContain('Assumptions')
    expect(out).toContain('production.product')
    expect(out).toContain('Copy')
    expect(out).toContain('2,000 prompt + 300 completion tokens')
    expect(out).toContain('Rate the answer as helpful')
    // Display formatting of the numeric revenue column.
    expect(out).toContain('1,234.50')
    expect(out).toContain('999.00')
  })

  it('stored answer without rows offers a re-run', () => {
    const out = html({ ...finished, status: 'answered', outcome: { kind: 'answer', data: { ...answer, rows: null } } })
    expect(out).toContain('Re-run query')
  })

  it('blocked shows layer, rule and reason; refusal and denial have their messages', () => {
    const blocked = html({
      ...finished,
      status: 'blocked',
      outcome: { kind: 'blocked', data: { stage: 'validation', rule: 'COLUMN_DENIED', message: 'humanresources.employee.nationalidnumber is denied' } },
    })
    expect(blocked).toContain('Blocked by the safety pipeline')
    expect(blocked).toContain('SQL policy (parser)')
    expect(blocked).toContain('COLUMN_DENIED')
    expect(blocked).toContain('nationalidnumber is denied')
    const refused = html({ ...finished, status: 'cannot_answer', outcome: { kind: 'cannot_answer', reason: 'Not a read question' } })
    expect(refused).toContain('be answered from the database')
    expect(refused).toContain('Not a read question')
    expect(html({ ...finished, status: 'cancelled' })).toContain('You denied the expensive query')
  })

  it('a lost stream offers a reconnect; a detached run offers to show the result', () => {
    expect(html({ ...finished, outcome: { kind: 'error', code: 'STREAM_LOST', message: 'Lost the live connection to the server.' } })).toContain('Reconnect')
    const detached = html({ ...finished, detached: true })
    expect(detached).toContain('You stopped waiting')
    expect(detached).toContain('Show result')
  })

  it('a stored record renders with its step durations', () => {
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
    const out = renderToStaticMarkup(<ThreadTurn turn={turnFromRecord(q)} />)
    expect(out).toContain('There are 19,820 customers.')
    expect(out).toContain('Re-run query')
    expect(out).toContain('1 step · 1.0 s')
    expect(out).toContain('12 ms')
  })
})

describe('result view renders', () => {
  it('no chart when chooseChart says no; the table still shows', () => {
    const out = renderToStaticMarkup(
      <ResultView columns={[{ name: 'total', type: 'numeric' }, { name: 'revenue', type: 'numeric' }]} rows={[['2024', '1']]} truncated />,
    )
    expect(out).not.toContain('<svg')
    expect(out).toContain('cut at the row limit')
  })

  it('a line chart for a date dimension', () => {
    const out = renderToStaticMarkup(
      <ResultView
        columns={[{ name: 'month', type: 'timestamp without time zone' }, { name: 'revenue', type: 'numeric' }]}
        rows={[['2024-01-01 00:00:00', '5'], ['2024-02-01 00:00:00', '7']]}
        truncated={false}
      />,
    )
    expect(out).toContain('aria-label="Line chart: Revenue by month.')
    expect(out).toContain('Jan 2024')
    expect(out).toContain('Feb 2024')
    expect(out).not.toContain('00:00:00')
  })

  it('a numeric year column: bars for 2 years with titles and units', () => {
    const out = renderToStaticMarkup(
      <ResultView
        columns={[{ name: 'order_year', type: 'numeric' }, { name: 'revenue', type: 'numeric' }]}
        rows={[['2023', '43671889.5037'], ['2024', '20008518.36']]}
        truncated={false}
      />,
    )
    expect(out).toContain('aria-label="Bar chart: Revenue by order year.')
    expect(out).toContain('Revenue (USD)')
    expect(out).toContain('Order year')
    expect(out).toContain('$50M')
    // Table: whole years unchanged, money with 2 decimals and no floating-point noise.
    expect(out).toContain('>2023<')
    expect(out).toContain('43,671,889.50')
    expect(out).not.toContain('43671889.5037')
  })

  it('many categories → horizontal bars; legend for two series', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`Territory number ${i}`, String(1000 + i), String(2000 + i)])
    const out = renderToStaticMarkup(
      <ResultView
        columns={[{ name: 'territory', type: 'text' }, { name: 'revenue_2023', type: 'numeric' }, { name: 'revenue_2024', type: 'numeric' }]}
        rows={rows}
        truncated={false}
      />,
    )
    expect(out).toContain('aria-label="Horizontal bar chart: Revenue by territory, 2023 vs 2024.')
    expect(out).toContain('aria-label="Series"')
    expect(out).toContain('>2023</li>')
    expect(out).toContain('Revenue 2024 (USD)')
  })
})
