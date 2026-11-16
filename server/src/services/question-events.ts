import type { ApprovalRequest, ClarificationRequest, StepEvent } from '../agent/graph.js'
import type { StoredColumn } from '../db/schema.js'

// In-memory SSE event bus (IMPLEMENTATION.md 14.3, decision D16: single instance).
// While a run segment is active its events are buffered, so a client that connects
// late in the segment gets every event in order; the buffer (including the masked
// answer rows) is dropped when the segment ends with `done`. After that, a client
// is served from the stored record instead.

export interface AnswerEventData {
  answer: string
  explanation: string
  sql: string
  tablesUsed: string[]
  assumptions: string[]
  columns: StoredColumn[]
  /** Masked rows; null when served from the stored record (rows are never stored, use rerun). */
  rows: unknown[][] | null
  rowCount: number
  truncated: boolean
  tokens: { prompt: number; completion: number; embedding: number }
  latencyMs: number | null
}

export type QuestionEvent =
  | { event: 'step'; data: StepEvent }
  | { event: 'clarification_required'; data: ClarificationRequest }
  | { event: 'approval_required'; data: ApprovalRequest }
  | { event: 'blocked'; data: { stage: string; rule: string; message: string } }
  | { event: 'answer'; data: AnswerEventData }
  | { event: 'cannot_answer'; data: { reason: string } }
  | { event: 'error'; data: { code: string; message: string } }
  | { event: 'done'; data: { status: string } }

export type EventListener = (event: QuestionEvent) => void

export interface QuestionEventBus {
  /** Marks a run segment active (before the HTTP 202 is sent). */
  start(questionId: string): void
  /** Buffers and delivers an event; `done` also ends the segment. */
  publish(questionId: string, event: QuestionEvent): void
  /** Buffered events so far plus live delivery; null when no segment is active. */
  subscribe(questionId: string, listener: EventListener): { replay: QuestionEvent[]; unsubscribe: () => void } | null
  isActive(questionId: string): boolean
}

interface Segment {
  events: QuestionEvent[]
  listeners: Set<EventListener>
}

export function createQuestionEventBus(): QuestionEventBus {
  const segments = new Map<string, Segment>()
  return {
    start(questionId): void {
      segments.set(questionId, { events: [], listeners: new Set() })
    },
    publish(questionId, event): void {
      const segment = segments.get(questionId)
      if (segment === undefined) return
      segment.events.push(event)
      for (const listener of segment.listeners) listener(event)
      if (event.event === 'done') segments.delete(questionId)
    },
    subscribe(questionId, listener): { replay: QuestionEvent[]; unsubscribe: () => void } | null {
      const segment = segments.get(questionId)
      if (segment === undefined) return null
      segment.listeners.add(listener)
      return {
        replay: [...segment.events],
        unsubscribe: (): void => {
          segment.listeners.delete(listener)
        },
      }
    },
    isActive(questionId): boolean {
      return segments.has(questionId)
    },
  }
}
