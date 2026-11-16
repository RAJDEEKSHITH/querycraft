import { describe, expect, it } from 'vitest'
import type { AnswerData, QuestionEvent } from '../types/api'
import { activeTurn, askReducer, initialAskState, type AskAction, type AskState } from './ask-reducer'

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
      { node: 'input_guard', status: 'completed', detail: null },
      { node: 'generate', status: 'completed', detail: { action: 'sql', attempt: 1 } },
      { node: 'execute', status: 'started', detail: null },
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
    expect(turnOf(s).steps).toEqual([{ node: 'answer', status: 'completed', detail: null }])
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
