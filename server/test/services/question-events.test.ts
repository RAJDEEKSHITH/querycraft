import { describe, expect, it } from 'vitest'
import { createQuestionEventBus, type QuestionEvent } from '../../src/services/question-events.js'

// In-memory SSE bus (IMPLEMENTATION.md 14.3): ordered delivery, late connect within
// a segment, and nothing kept after `done`.

const step = (node: 'input_guard' | 'generate', status: 'started' | 'completed'): QuestionEvent => ({ event: 'step', data: { node, status } })

describe('question event bus', () => {
  it('a subscriber that connects mid-segment gets the buffered events, then live ones, in order', () => {
    const bus = createQuestionEventBus()
    bus.start('q1')
    bus.publish('q1', step('input_guard', 'started'))
    bus.publish('q1', step('input_guard', 'completed'))
    const seen: QuestionEvent[] = []
    const sub = bus.subscribe('q1', (e) => seen.push(e))
    expect(sub?.replay).toEqual([step('input_guard', 'started'), step('input_guard', 'completed')])
    bus.publish('q1', step('generate', 'started'))
    bus.publish('q1', { event: 'done', data: { status: 'answered' } })
    expect(seen).toEqual([step('generate', 'started'), { event: 'done', data: { status: 'answered' } }])
  })

  it('drops the segment (and its rows) at done; no subscription afterwards; other questions are separate', () => {
    const bus = createQuestionEventBus()
    bus.start('q1')
    bus.start('q2')
    bus.publish('q1', { event: 'done', data: { status: 'failed' } })
    expect(bus.isActive('q1')).toBe(false)
    expect(bus.subscribe('q1', () => undefined)).toBeNull()
    expect(bus.isActive('q2')).toBe(true)
    bus.publish('q1', step('generate', 'started')) // ignored: no active segment
    expect(bus.subscribe('q2', () => undefined)?.replay).toEqual([])
  })

  it('stops delivering after unsubscribe', () => {
    const bus = createQuestionEventBus()
    bus.start('q1')
    const seen: QuestionEvent[] = []
    const sub = bus.subscribe('q1', (e) => seen.push(e))
    sub?.unsubscribe()
    bus.publish('q1', step('generate', 'started'))
    expect(seen).toEqual([])
  })
})
