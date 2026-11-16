import { NODE_NAMES, type AnswerData, type QuestionEvent, type QuestionEventName } from '../types/api'
import { isNumber, isRecord, isString, isStringArray } from './guards'
import { API_BASE_URL } from './http'

// SSE client for GET /api/questions/:id/events (IMPLEMENTATION.md 14.3), on the
// native EventSource. Every stream ends with `done`, also when the run pauses for a
// clarification or an approval; after a resume the caller opens a new stream.

export const EVENT_NAMES: readonly QuestionEventName[] = [
  'step',
  'clarification_required',
  'approval_required',
  'blocked',
  'answer',
  'cannot_answer',
  'error',
  'done',
]

function isColumns(value: unknown): value is AnswerData['columns'] {
  return Array.isArray(value) && value.every((c) => isRecord(c) && isString(c['name']) && isString(c['type']))
}

function isRows(value: unknown): value is unknown[][] | null {
  return value === null || (Array.isArray(value) && value.every((r) => Array.isArray(r)))
}

function isTokens(value: unknown): value is AnswerData['tokens'] {
  return isRecord(value) && isNumber(value['prompt']) && isNumber(value['completion']) && isNumber(value['embedding'])
}

function parseAnswer(d: Record<string, unknown>): AnswerData | null {
  const { answer, explanation, sql, tablesUsed, assumptions, columns, rows, rowCount, truncated, tokens, latencyMs } = d
  if (
    !isString(answer) ||
    !isString(explanation) ||
    !isString(sql) ||
    !isStringArray(tablesUsed) ||
    !isStringArray(assumptions) ||
    !isColumns(columns) ||
    !isRows(rows) ||
    !isNumber(rowCount) ||
    typeof truncated !== 'boolean' ||
    !isTokens(tokens) ||
    !(latencyMs === null || isNumber(latencyMs))
  ) {
    return null
  }
  return { answer, explanation, sql, tablesUsed, assumptions, columns, rows, rowCount, truncated, tokens, latencyMs }
}

/** Parses one SSE frame into a typed event; null when the name or data does not match the contract. */
export function parseEvent(name: string, raw: string): QuestionEvent | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(data)) return null
  switch (name) {
    case 'step': {
      const { node, status, detail } = data
      const knownNode = NODE_NAMES.find((n) => n === node)
      if (knownNode === undefined || (status !== 'started' && status !== 'completed')) return null
      if (detail !== undefined && !isRecord(detail)) return null
      return { event: 'step', data: detail === undefined ? { node: knownNode, status } : { node: knownNode, status, detail } }
    }
    case 'clarification_required':
      return isString(data['question']) && isStringArray(data['options'])
        ? { event: 'clarification_required', data: { question: data['question'], options: data['options'] } }
        : null
    case 'approval_required':
      return isNumber(data['estimatedCost']) && isNumber(data['softLimit']) && isString(data['sql'])
        ? {
            event: 'approval_required',
            data: { estimatedCost: data['estimatedCost'], softLimit: data['softLimit'], sql: data['sql'] },
          }
        : null
    case 'blocked':
      return isString(data['stage']) && isString(data['rule']) && isString(data['message'])
        ? { event: 'blocked', data: { stage: data['stage'], rule: data['rule'], message: data['message'] } }
        : null
    case 'answer': {
      const answer = parseAnswer(data)
      return answer === null ? null : { event: 'answer', data: answer }
    }
    case 'cannot_answer':
      return isString(data['reason']) ? { event: 'cannot_answer', data: { reason: data['reason'] } } : null
    case 'error':
      return isString(data['code']) && isString(data['message'])
        ? { event: 'error', data: { code: data['code'], message: data['message'] } }
        : null
    case 'done':
      return isString(data['status']) ? { event: 'done', data: { status: data['status'] } } : null
    default:
      return null
  }
}

export interface StreamHandlers {
  onEvent: (event: QuestionEvent) => void
  /** The connection dropped and was re-opened: the server replays the current run segment from its start. */
  onReplay: () => void
  /** The stream ended without `done` (connection lost twice, or the server refused it). */
  onFailure: (message: string) => void
}

/** The parts of EventSource this module uses (lets tests pass a fake). */
export interface EventSourceLike {
  readonly readyState: number
  addEventListener(type: string, listener: (event: Event) => void): void
  close(): void
}

const CLOSED = 2
const MAX_RECONNECTS = 1

export function questionEventsUrl(questionId: string): string {
  return `${API_BASE_URL}/api/questions/${encodeURIComponent(questionId)}/events`
}

/** Opens the event stream of a question; returns a function that closes it. */
export function openQuestionStream(
  questionId: string,
  handlers: StreamHandlers,
  createSource: (url: string) => EventSourceLike = (url) => new EventSource(url),
): () => void {
  const source = createSource(questionEventsUrl(questionId))
  let finished = false
  let opened = false
  let reconnects = 0

  const close = (): void => {
    finished = true
    source.close()
  }
  const fail = (message: string): void => {
    if (finished) return
    close()
    handlers.onFailure(message)
  }
  const deliver = (name: string, raw: unknown): void => {
    if (finished) return
    const event = typeof raw === 'string' ? parseEvent(name, raw) : null
    if (event === null) {
      fail('Received an unreadable update from the server.')
      return
    }
    handlers.onEvent(event)
    // Close before the browser would reconnect to the ended response.
    if (event.event === 'done') close()
  }

  source.addEventListener('open', () => {
    if (finished) return
    if (opened) handlers.onReplay()
    opened = true
  })
  for (const name of EVENT_NAMES) {
    if (name === 'error') continue
    source.addEventListener(name, (e) => {
      deliver(name, e instanceof MessageEvent ? e.data : undefined)
    })
  }
  // `error` is both the server's named event (a MessageEvent with data) and the
  // browser's connection-error event (a plain Event).
  source.addEventListener('error', (e) => {
    if (finished) return
    if (e instanceof MessageEvent && typeof e.data === 'string') {
      deliver('error', e.data)
      return
    }
    if (source.readyState === CLOSED) {
      fail('Could not open the live updates for this question.')
      return
    }
    reconnects += 1
    if (reconnects > MAX_RECONNECTS) fail('Lost the live connection to the server.')
  })

  return close
}
