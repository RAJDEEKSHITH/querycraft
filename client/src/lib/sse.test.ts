import { describe, expect, it } from 'vitest'
import type { QuestionEvent } from '../types/api'
import { openQuestionStream, parseEvent, questionEventsUrl, type EventSourceLike } from './sse'

const answerData = {
  answer: 'a',
  explanation: 'e',
  sql: 'SELECT 1',
  tablesUsed: ['sales.customer'],
  assumptions: [],
  columns: [{ name: 'n', type: 'integer' }],
  rows: [[1]],
  rowCount: 1,
  truncated: false,
  tokens: { prompt: 1, completion: 2, embedding: 0 },
  latencyMs: 10,
}

describe('parseEvent', () => {
  it('parses every event of the contract', () => {
    expect(parseEvent('step', '{"node":"generate","status":"completed","detail":{"attempt":2}}')).toEqual({
      event: 'step',
      data: { node: 'generate', status: 'completed', detail: { attempt: 2 } },
    })
    expect(parseEvent('clarification_required', '{"question":"Which?","options":["a","b"]}')?.event).toBe('clarification_required')
    expect(parseEvent('approval_required', '{"estimatedCost":9,"softLimit":5,"sql":"SELECT 1"}')?.event).toBe('approval_required')
    expect(parseEvent('blocked', '{"stage":"validation","rule":"NOT_SELECT","message":"m"}')?.event).toBe('blocked')
    expect(parseEvent('answer', JSON.stringify(answerData))).toEqual({ event: 'answer', data: answerData })
    expect(parseEvent('answer', JSON.stringify({ ...answerData, rows: null, latencyMs: null }))?.event).toBe('answer')
    expect(parseEvent('cannot_answer', '{"reason":"r"}')).toEqual({ event: 'cannot_answer', data: { reason: 'r' } })
    expect(parseEvent('error', '{"code":"INTERNAL_ERROR","message":"m"}')?.event).toBe('error')
    expect(parseEvent('done', '{"status":"answered"}')).toEqual({ event: 'done', data: { status: 'answered' } })
  })

  it('rejects unknown events, bad JSON and wrong shapes', () => {
    expect(parseEvent('surprise', '{}')).toBeNull()
    expect(parseEvent('done', 'not json')).toBeNull()
    expect(parseEvent('done', '[]')).toBeNull()
    expect(parseEvent('step', '{"node":"drop_table","status":"started"}')).toBeNull()
    expect(parseEvent('step', '{"node":"generate","status":"paused"}')).toBeNull()
    expect(parseEvent('answer', JSON.stringify({ ...answerData, rows: 'x' }))).toBeNull()
    expect(parseEvent('answer', JSON.stringify({ ...answerData, tokens: { prompt: 1 } }))).toBeNull()
    expect(parseEvent('clarification_required', '{"question":"q","options":[1]}')).toBeNull()
  })
})

class FakeSource implements EventSourceLike {
  readyState = 0
  closed = false
  private listeners = new Map<string, ((e: Event) => void)[]>()
  readonly url: string
  constructor(url: string) {
    this.url = url
  }
  addEventListener(type: string, listener: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  close(): void {
    this.closed = true
    this.readyState = 2
  }
  emit(type: string, data?: string): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data })
    for (const l of this.listeners.get(type) ?? []) l(event)
  }
  open(): void {
    this.readyState = 1
    this.emit('open')
  }
}

function setup() {
  const events: QuestionEvent[] = []
  const failures: string[] = []
  let replays = 0
  const sources: FakeSource[] = []
  const close = openQuestionStream(
    'q-1',
    {
      onEvent: (e) => events.push(e),
      onReplay: () => {
        replays += 1
      },
      onFailure: (m) => failures.push(m),
    },
    (url) => {
      const created = new FakeSource(url)
      sources.push(created)
      return created
    },
  )
  const [source] = sources
  if (source === undefined) throw new Error('no source')
  return { source, events, failures, replays: () => replays, close }
}

describe('openQuestionStream', () => {
  it('opens the question events URL', () => {
    const { source } = setup()
    expect(source.url).toBe(questionEventsUrl('q-1'))
    expect(source.url.endsWith('/api/questions/q-1/events')).toBe(true)
  })

  it('delivers events in order and closes on done', () => {
    const { source, events } = setup()
    source.open()
    source.emit('step', '{"node":"input_guard","status":"started"}')
    source.emit('answer', JSON.stringify(answerData))
    source.emit('done', '{"status":"answered"}')
    source.emit('step', '{"node":"answer","status":"started"}')
    expect(events.map((e) => e.event)).toEqual(['step', 'answer', 'done'])
    expect(source.closed).toBe(true)
  })

  it("treats the server's named error event as an event, not a connection failure", () => {
    const { source, events, failures } = setup()
    source.open()
    source.emit('error', '{"code":"UPSTREAM_RATE_LIMITED","message":"busy"}')
    expect(events).toEqual([{ event: 'error', data: { code: 'UPSTREAM_RATE_LIMITED', message: 'busy' } }])
    expect(failures).toEqual([])
  })

  it('a reconnect after a drop reports a replay; a second drop fails', () => {
    const { source, failures, replays } = setup()
    source.open()
    source.readyState = 0
    source.emit('error')
    expect(failures).toEqual([])
    source.open()
    expect(replays()).toBe(1)
    source.readyState = 0
    source.emit('error')
    expect(failures).toHaveLength(1)
    expect(source.closed).toBe(true)
  })

  it('a refused stream (closed by the browser) fails at once', () => {
    const { source, failures } = setup()
    source.readyState = 2
    source.emit('error')
    expect(failures).toEqual(['Could not open the live updates for this question.'])
  })

  it('an unreadable frame fails the stream', () => {
    const { source, failures, events } = setup()
    source.open()
    source.emit('done', '{"nope":1}')
    expect(events).toEqual([])
    expect(failures).toHaveLength(1)
  })

  it('the returned function closes the stream and silences it', () => {
    const { source, events, close } = setup()
    close()
    source.emit('done', '{"status":"answered"}')
    expect(source.closed).toBe(true)
    expect(events).toEqual([])
  })
})
