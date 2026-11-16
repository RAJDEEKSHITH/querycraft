import {
  QUESTION_STATUSES,
  type AnswerData,
  type ApprovalRequest,
  type BlockedInfo,
  type ClarificationRequest,
  type Column,
  type NodeName,
  type QuestionEvent,
  type QuestionStatus,
} from '../types/api'

// Pure state transitions of the Ask view (askStore wraps them). One "turn" is one
// question of the current conversation; its steps span every run segment (a
// clarification or approval pause starts a new segment and a new stream).

export interface StepItem {
  node: NodeName
  status: 'started' | 'completed'
  detail: Record<string, unknown> | null
}

export type Outcome =
  | { kind: 'answer'; data: AnswerData }
  | { kind: 'blocked'; data: BlockedInfo }
  | { kind: 'cannot_answer'; reason: string }
  | { kind: 'error'; code: string; message: string }

export interface Turn {
  questionId: string
  question: string
  status: QuestionStatus
  /** True while an event stream for this turn is open. */
  streaming: boolean
  steps: StepItem[]
  /** Index in `steps` where the current run segment starts (a replay restarts there). */
  segmentStart: number
  clarification: ClarificationRequest | null
  approval: ApprovalRequest | null
  outcome: Outcome | null
  /** Rows fetched by a rerun when the answer came from the stored record (rows: null). */
  rerunRows: { columns: Column[]; rows: unknown[][]; truncated: boolean } | null
  feedback: { rating: 'up' | 'down'; exampleCreated: boolean } | null
}

export interface AskState {
  conversationId: string | null
  turns: Turn[]
}

export type AskAction =
  | { type: 'question_created'; questionId: string; conversationId: string; question: string }
  | { type: 'segment_started'; questionId: string }
  | { type: 'stream_replayed'; questionId: string }
  | { type: 'reconnecting'; questionId: string }
  | { type: 'event'; questionId: string; event: QuestionEvent }
  | { type: 'stream_failed'; questionId: string; message: string }
  | { type: 'rerun_rows'; questionId: string; columns: Column[]; rows: unknown[][]; truncated: boolean }
  | { type: 'feedback_sent'; questionId: string; rating: 'up' | 'down'; exampleCreated: boolean }
  | { type: 'reset' }

export const initialAskState: AskState = { conversationId: null, turns: [] }

function toStatus(value: string): QuestionStatus {
  return QUESTION_STATUSES.find((s) => s === value) ?? 'failed'
}

function applyStep(steps: StepItem[], node: NodeName, status: 'started' | 'completed', detail: Record<string, unknown> | null): StepItem[] {
  if (status === 'started') return [...steps, { node, status, detail: null }]
  // Complete the most recent started step of this node.
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i]
    if (step !== undefined && step.node === node && step.status === 'started') {
      const next = steps.slice()
      next[i] = { node, status: 'completed', detail }
      return next
    }
  }
  return [...steps, { node, status, detail }]
}

function applyEvent(turn: Turn, event: QuestionEvent): Turn {
  switch (event.event) {
    case 'step':
      return { ...turn, steps: applyStep(turn.steps, event.data.node, event.data.status, event.data.detail ?? null) }
    case 'clarification_required':
      return { ...turn, status: 'awaiting_clarification', clarification: event.data }
    case 'approval_required':
      return { ...turn, status: 'awaiting_approval', approval: event.data }
    case 'blocked':
      return { ...turn, status: 'blocked', outcome: { kind: 'blocked', data: event.data } }
    case 'answer':
      return { ...turn, status: 'answered', outcome: { kind: 'answer', data: event.data } }
    case 'cannot_answer':
      return { ...turn, status: 'cannot_answer', outcome: { kind: 'cannot_answer', reason: event.data.reason } }
    case 'error':
      return { ...turn, outcome: { kind: 'error', code: event.data.code, message: event.data.message } }
    case 'done':
      return { ...turn, status: toStatus(event.data.status), streaming: false }
  }
}

function updateTurn(state: AskState, questionId: string, update: (turn: Turn) => Turn): AskState {
  let changed = false
  const turns = state.turns.map((t) => {
    if (t.questionId !== questionId) return t
    changed = true
    return update(t)
  })
  return changed ? { ...state, turns } : state
}

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case 'question_created':
      return {
        conversationId: action.conversationId,
        turns: [
          ...state.turns,
          {
            questionId: action.questionId,
            question: action.question,
            status: 'running',
            streaming: false,
            steps: [],
            segmentStart: 0,
            clarification: null,
            approval: null,
            outcome: null,
            rerunRows: null,
            feedback: null,
          },
        ],
      }
    case 'segment_started':
      return updateTurn(state, action.questionId, (t) => {
        // A paused node (clarify / approval) never completed: it runs again on resume,
        // so its dangling `started` step is dropped instead of shown twice.
        const steps = t.steps.filter((x) => x.status === 'completed')
        return { ...t, status: 'running', streaming: true, steps, segmentStart: steps.length, clarification: null, approval: null }
      })
    case 'stream_replayed':
      // The server resends the segment from its start: drop what this segment already showed.
      return updateTurn(state, action.questionId, (t) => ({
        ...t,
        steps: t.steps.slice(0, t.segmentStart),
        clarification: null,
        approval: null,
        outcome: null,
      }))
    case 'reconnecting':
      // A user-requested new stream after a failure: same as a replay, streaming again.
      return updateTurn(state, action.questionId, (t) => ({
        ...t,
        streaming: true,
        steps: t.steps.slice(0, t.segmentStart),
        clarification: null,
        approval: null,
        outcome: null,
      }))
    case 'event':
      return updateTurn(state, action.questionId, (t) => applyEvent(t, action.event))
    case 'stream_failed':
      return updateTurn(state, action.questionId, (t) => ({
        ...t,
        streaming: false,
        outcome: t.outcome ?? { kind: 'error', code: 'STREAM_LOST', message: action.message },
      }))
    case 'rerun_rows':
      return updateTurn(state, action.questionId, (t) => ({
        ...t,
        rerunRows: { columns: action.columns, rows: action.rows, truncated: action.truncated },
      }))
    case 'feedback_sent':
      return updateTurn(state, action.questionId, (t) => ({ ...t, feedback: { rating: action.rating, exampleCreated: action.exampleCreated } }))
    case 'reset':
      return initialAskState
  }
}

/** The turn a new question would have to wait for (running or paused), if any. */
export function activeTurn(state: AskState): Turn | null {
  const last = state.turns.at(-1)
  if (last === undefined) return null
  const active = last.streaming || last.status === 'running' || last.status === 'awaiting_clarification' || last.status === 'awaiting_approval'
  return active ? last : null
}
