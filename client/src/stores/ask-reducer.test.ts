import { describe, expect, it } from 'vitest'
import type { AnswerData, QuestionEvent, QuestionView } from '../types/api'
import { activeTurn, askReducer, initialAskState, turnFromRecord, type AskAction, type AskState } from './ask-reducer'

const Q = '11111111-1111-4111-8111-111111111111'
const C = '22222222-2222-4222-8222-222222222222'

const answer: AnswerData = {
  answer: 'There are 19,820 customers.',
  explanation: 'Counted sales.customer rows.',
  sql: 'SELECT count(*) FROM sales.customer',
  tablesUsed: ['sales.customer'],
  assumptions: [],
  columns: [{ name: 'count', type: 'bigint' }],
  rows: [['19820']],
  rowCount: 1,
  truncated: false,
  tokens: { prompt: 1000, completion: 100, embedding: 0 },
  latencyMs: 1234,
}

function run(actions: AskAction[], state: AskState = initialAskState): AskState {
  return actions.reduce(askReducer, state)
}

const ev = (event: QuestionEvent): AskAction => ({ type: 'event', questionId: Q, event })
const started = (node: Parameters<typeof step>[0]): AskAction => step(node, 'started')
const completed = (node: Parameters<typeof step>[0], detail?: Record<string, unknown>): AskAction => step(node, 'completed', detail)
function step(
  node: 'input_guard' | 'retrieve_context' | 'generate' | 'clarify' | 'validate_sql' | 'cost_check' | 'approval' | 'execute' | 'mask_output' | 'answer',
  status: 'started' | 'completed',
  detail?: Record<string, unknown>,
): AskAction {
  return ev({ event: 'step', data: detail === undefined ? { node, status } : { node, status, detail } })
}

const create: AskAction[] = [
  { type: 'question_created', questionId: Q, conversationId: C, question: 'How many customers do we have?' },
  { type: 'segment_started', questionId: Q },
]

function turnOf(state: AskState) {
  const turn = state.turns[0]
  if (turn === undefined) throw new Error('no turn')
  return turn
}

describe('askReducer', () => {
  it('a question starts a running, streaming turn in a conversation', () => {
    const s = run(create)
    expect(s.conversationId).toBe(C)
    expect(turnOf(s)).toMatchObject({ questionId: Q, status: 'running', streaming: true, steps: [], outcome: null })
    expect(activeTurn(s)).not.toBeNull()
  })

  it('steps: started then completed (with detail) in order', () => {
    const s = run([
      ...create,
      started('input_guard'),
      completed('input_guard'),
      started('generate'),
      completed('generate', { action: 'sql', attempt: 1 }),
      started('execute'),
    ])
    expect(turnOf(s).steps).toEqual([
      { node: 'input_guard', status: 'completed', detail: null, durationMs: null },
      { node: 'generate', status: 'completed', detail: { action: 'sql', attempt: 1 }, durationMs: null },
      { node: 'execute', status: 'started', detail: null, durationMs: null },
    ])
  })

  it('a retried node appears twice (self-correction stays visible)', () => {
    const s = run([
      ...create,
      started('generate'),
      completed('generate', { action: 'sql', attempt: 1 }),
      started('execute'),
      completed('execute', { rowCount: 0, truncated: false }),
      started('generate'),
      completed('generate', { action: 'sql', attempt: 2 }),
    ])
    const generates = turnOf(s).steps.filter((x) => x.node === 'generate')
    expect(generates.map((g) => g.detail?.['attempt'])).toEqual([1, 2])
  })

  it('a completed event without a started one is still shown', () => {
    const s = run([...create, completed('answer')])
    expect(turnOf(s).steps).toEqual([{ node: 'answer', status: 'completed', detail: null, durationMs: null }])
  })

  it('answer then done → answered and finished', () => {
    const s = run([...create, ev({ event: 'answer', data: answer }), ev({ event: 'done', data: { status: 'answered' } })])
    expect(turnOf(s)).toMatchObject({ status: 'answered', streaming: false, outcome: { kind: 'answer', data: answer } })
    expect(activeTurn(s)).toBeNull()
  })

  it('blocked, cannot_answer and error outcomes', () => {
    const blocked = run([
      ...create,
      ev({ event: 'blocked', data: { stage: 'validation', rule: 'COLUMN_DENIED', message: 'denied' } }),
      ev({ event: 'done', data: { status: 'blocked' } }),
    ])
    expect(turnOf(blocked)).toMatchObject({ status: 'blocked', outcome: { kind: 'blocked', data: { rule: 'COLUMN_DENIED' } } })

    const refused = run([...create, ev({ event: 'cannot_answer', data: { reason: 'no data' } }), ev({ event: 'done', data: { status: 'cannot_answer' } })])
    expect(turnOf(refused).outcome).toEqual({ kind: 'cannot_answer', reason: 'no data' })

    const failed = run([
      ...create,
      ev({ event: 'error', data: { code: 'BUDGET_EXCEEDED', message: 'limit' } }),
      ev({ event: 'done', data: { status: 'failed' } }),
    ])
    expect(turnOf(failed)).toMatchObject({ status: 'failed', outcome: { kind: 'error', code: 'BUDGET_EXCEEDED' } })
  })

  it('an unknown done status counts as failed', () => {
    const s = run([...create, ev({ event: 'done', data: { status: 'weird' } })])
    expect(turnOf(s).status).toBe('failed')
  })

  it('clarification pause, then a new segment keeps earlier steps', () => {
    const paused = run([
      ...create,
      started('generate'),
      completed('generate', { action: 'clarify' }),
      started('clarify'),
      ev({ event: 'clarification_required', data: { question: 'Which year?', options: ['2024', '2025'] } }),
      ev({ event: 'done', data: { status: 'awaiting_clarification' } }),
    ])
    expect(turnOf(paused)).toMatchObject({
      status: 'awaiting_clarification',
      streaming: false,
      clarification: { question: 'Which year?', options: ['2024', '2025'] },
    })
    expect(activeTurn(paused)).not.toBeNull()

    const resumed = run([{ type: 'segment_started', questionId: Q }, started('clarify'), completed('clarify')], paused)
    const t = turnOf(resumed)
    // The clarify step that paused is dropped; the node runs again in the new segment.
    expect(t).toMatchObject({ status: 'running', streaming: true, clarification: null, segmentStart: 1 })
    expect(t.steps.map((x) => `${x.node}:${x.status}`)).toEqual(['generate:completed', 'clarify:completed'])
  })

  it('approval pause shows the request; a new segment clears it', () => {
    const paused = run([
      ...create,
      ev({ event: 'approval_required', data: { estimatedCost: 90000, softLimit: 50000, sql: 'SELECT 1' } }),
      ev({ event: 'done', data: { status: 'awaiting_approval' } }),
    ])
    expect(turnOf(paused).approval).toEqual({ estimatedCost: 90000, softLimit: 50000, sql: 'SELECT 1' })
    const resumed = run([{ type: 'segment_started', questionId: Q }], paused)
    expect(turnOf(resumed).approval).toBeNull()
  })

  it('a replay after a reconnect drops only the current segment, so events are not doubled', () => {
    const first = run([
      ...create,
      started('generate'),
      completed('generate', { action: 'clarify' }),
      ev({ event: 'done', data: { status: 'awaiting_clarification' } }),
      { type: 'segment_started', questionId: Q },
      started('clarify'),
      completed('clarify'),
    ])
    const replayed = run(
      [{ type: 'stream_replayed', questionId: Q }, started('clarify'), completed('clarify'), started('generate')],
      first,
    )
    expect(turnOf(replayed).steps.map((x) => `${x.node}:${x.status}`)).toEqual([
      'generate:completed',
      'clarify:completed',
      'generate:started',
    ])
  })

  it('a lost stream shows an error that a reconnect clears', () => {
    const lost = run([...create, started('generate'), { type: 'stream_failed', questionId: Q, message: 'Lost the live connection' }])
    expect(turnOf(lost)).toMatchObject({ streaming: false, outcome: { kind: 'error', code: 'STREAM_LOST' } })
    const again = run([{ type: 'reconnecting', questionId: Q }], lost)
    expect(turnOf(again)).toMatchObject({ streaming: true, outcome: null, steps: [] })
  })

  it('a stream failure after an outcome keeps the outcome', () => {
    const s = run([...create, ev({ event: 'answer', data: answer }), { type: 'stream_failed', questionId: Q, message: 'x' }])
    expect(turnOf(s).outcome?.kind).toBe('answer')
  })

  it('late-connect answer without rows, then rerun rows and feedback', () => {
    const s = run([
      ...create,
      ev({ event: 'answer', data: { ...answer, rows: null } }),
      ev({ event: 'done', data: { status: 'answered' } }),
      { type: 'rerun_rows', questionId: Q, columns: answer.columns, rows: [['19820']], truncated: false },
      { type: 'feedback_sent', questionId: Q, rating: 'up', exampleCreated: true },
    ])
    expect(turnOf(s).rerunRows).toEqual({ columns: answer.columns, rows: [['19820']], truncated: false })
    expect(turnOf(s).feedback).toEqual({ rating: 'up', exampleCreated: true })
  })

  it('events for another question change nothing', () => {
    const s = run(create)
    const after = askReducer(s, { type: 'event', questionId: 'other', event: { event: 'done', data: { status: 'answered' } } })
    expect(after).toBe(s)
  })

  it('a follow-up adds a second turn in the same conversation; reset clears all', () => {
    const s = run([
      ...create,
      ev({ event: 'done', data: { status: 'answered' } }),
      { type: 'question_created', questionId: 'q2', conversationId: C, question: 'And in 2024?' },
    ])
    expect(s.turns.map((t) => t.questionId)).toEqual([Q, 'q2'])
    expect(askReducer(s, { type: 'reset' })).toEqual(initialAskState)
  })
})

const record = (over: Partial<QuestionView>): QuestionView => ({
  id: Q,
  conversationId: C,
  question: 'How many customers do we have?',
  status: 'answered',
  sql: 'SELECT count(*) FROM sales.customer',
  answer: 'We have 19820 customers.',
  explanation: 'Counted sales.customer rows.',
  tablesUsed: ['sales.customer'],
  assumptions: [],
  columns: [{ name: 'count', type: 'bigint' }],
  rowCount: 1,
  truncated: false,
  attempts: 1,
  trace: [
    { node: 'input_guard', startedAt: '2026-11-17T09:00:00.000Z', durationMs: 2 },
    { node: 'generate', startedAt: '2026-11-17T09:00:01.000Z', durationMs: 900, detail: { action: 'sql', attempt: 1 } },
    { node: 'not_a_node', startedAt: '2026-11-17T09:00:02.000Z', durationMs: 1 },
  ],
  errorCode: null,
  tokens: { prompt: 2000, completion: 200, embedding: 0 },
  costUsd: '0',
  latencyMs: 2162,
  createdAt: '2026-11-17T09:00:00.000Z',
  completedAt: '2026-11-17T09:00:02.162Z',
  clarification: null,
  approval: null,
  reason: null,
  blocked: null,
  error: null,
  ...over,
})

describe('opening a stored conversation', () => {
  it('maps an answered record: steps from the trace, answer without rows, the reported time', () => {
    const turn = turnFromRecord(record({}))
    expect(turn).toMatchObject({ questionId: Q, status: 'answered', streaming: false, detached: false, latencyMs: 2162, rerunRows: null })
    expect(turn.steps).toEqual([
      { node: 'input_guard', status: 'completed', detail: null, durationMs: 2 },
      { node: 'generate', status: 'completed', detail: { action: 'sql', attempt: 1 }, durationMs: 900 },
    ])
    expect(turn.segmentStart).toBe(2)
    expect(turn.outcome).toMatchObject({ kind: 'answer', data: { answer: 'We have 19820 customers.', rows: null, rowCount: 1 } })
  })

  it('maps blocked, cannot-answer, failed and cancelled records', () => {
    const blocked = { stage: 'validation', rule: 'NOT_SELECT', message: 'Only SELECT statements are allowed' }
    expect(turnFromRecord(record({ status: 'blocked', answer: null, blocked })).outcome).toEqual({ kind: 'blocked', data: blocked })
    expect(turnFromRecord(record({ status: 'cannot_answer', answer: null, reason: 'No such column' })).outcome).toEqual({
      kind: 'cannot_answer',
      reason: 'No such column',
    })
    expect(turnFromRecord(record({ status: 'failed', answer: null, errorCode: 'MAX_ATTEMPTS' })).outcome).toEqual({
      kind: 'error',
      code: 'MAX_ATTEMPTS',
      message: 'The question failed.',
    })
    expect(turnFromRecord(record({ status: 'cancelled', answer: null })).outcome).toBeNull()
  })

  it('keeps a pending clarification or approval so the thread can answer it', () => {
    const clarification = { question: 'Which periods?', options: ['Last 12 months', 'Calendar years'] }
    const paused = turnFromRecord(record({ status: 'awaiting_clarification', answer: null, clarification }))
    expect(paused.clarification).toEqual(clarification)
    expect(paused.outcome).toBeNull()
    const approval = { estimatedCost: 67939.43, softLimit: 50000, sql: 'SELECT 1' }
    expect(turnFromRecord(record({ status: 'awaiting_approval', answer: null, approval })).approval).toEqual(approval)
    // A finished record never shows a stale request.
    expect(turnFromRecord(record({ clarification })).clarification).toBeNull()
  })

  it('conversation_loaded replaces the thread', () => {
    const before = run(create)
    const s = askReducer(before, { type: 'conversation_loaded', conversationId: 'c2', questions: [record({ id: 'a' }), record({ id: 'b' })] })
    expect(s.conversationId).toBe('c2')
    expect(s.turns.map((t) => t.questionId)).toEqual(['a', 'b'])
    expect(activeTurn(s)).toBeNull()
    expect(activeTurn(askReducer(s, { type: 'conversation_loaded', conversationId: 'c2', questions: [record({ status: 'running', answer: null })] }))).not.toBeNull()
  })
})

describe('stop waiting', () => {
  it('closes the turn on the client only and frees the composer', () => {
    const s = run([...create, started('generate'), { type: 'stop_waiting', questionId: Q }])
    expect(turnOf(s)).toMatchObject({ status: 'running', streaming: false, detached: true })
    expect(activeTurn(s)).toBeNull()
  })

  it('a reconnect follows the run again', () => {
    const s = run([...create, { type: 'stop_waiting', questionId: Q }, { type: 'reconnecting', questionId: Q }])
    expect(turnOf(s)).toMatchObject({ streaming: true, detached: false })
    expect(activeTurn(s)).not.toBeNull()
  })

  it('does nothing to a turn that is not streaming (paused for the user)', () => {
    const s = run([
      ...create,
      ev({ event: 'clarification_required', data: { question: 'Which?', options: ['A', 'B'] } }),
      ev({ event: 'done', data: { status: 'awaiting_clarification' } }),
      { type: 'stop_waiting', questionId: Q },
    ])
    expect(turnOf(s)).toMatchObject({ detached: false, status: 'awaiting_clarification' })
    expect(activeTurn(s)).not.toBeNull()
  })

  it('keeps answered clarifications and approval decisions in order', () => {
    const s = run([
      ...create,
      { type: 'exchange_added', questionId: Q, exchange: { kind: 'clarification', question: 'Which periods?', answer: 'Calendar years' } },
      { type: 'exchange_added', questionId: Q, exchange: { kind: 'approval', estimatedCost: 67939.43, approved: true } },
    ])
    expect(turnOf(s).exchanges).toEqual([
      { kind: 'clarification', question: 'Which periods?', answer: 'Calendar years' },
      { kind: 'approval', estimatedCost: 67939.43, approved: true },
    ])
  })

  it('records the reported time from the answer', () => {
    const s = run([...create, ev({ event: 'answer', data: answer }), ev({ event: 'done', data: { status: 'answered' } })])
    expect(turnOf(s).latencyMs).toBe(1234)
  })
})
