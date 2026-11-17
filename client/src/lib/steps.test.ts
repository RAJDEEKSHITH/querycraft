import { describe, expect, it } from 'vitest'
import { conversationHash, isLegacyHistoryHash, routeFromHash } from './hash-route'
import { activeLabel, isRetry, nodeLabel, stepNote, timelineSummary } from './steps'

describe('step notes', () => {
  it('marks a second generate attempt as self-correction', () => {
    expect(stepNote('generate', { action: 'sql', attempt: 2 })).toBe('attempt 2 (self-correction)')
    expect(isRetry('generate', { action: 'sql', attempt: 2 })).toBe(true)
    expect(isRetry('generate', { action: 'sql', attempt: 1 })).toBe(false)
  })

  it('describes rules, costs and row counts', () => {
    expect(stepNote('validate_sql', { rule: 'COLUMN_DENIED' })).toBe('COLUMN_DENIED')
    expect(stepNote('cost_check', { cost: 91234.5, rule: 'COST_SOFT_LIMIT' })).toContain('COST_SOFT_LIMIT')
    expect(stepNote('execute', { rowCount: 0, truncated: false })).toBe('0 rows')
    expect(stepNote('execute', { rowCount: 500, truncated: true })).toContain('row limit')
    expect(stepNote('approval', { approved: false })).toBe('denied')
    expect(stepNote('mask_output', { maskedColumns: [] })).toBeNull()
    expect(stepNote('answer', undefined)).toBeNull()
  })

  it('labels every node and falls back to the raw name', () => {
    expect(nodeLabel('retrieve_context')).not.toBe('retrieve_context')
    expect(nodeLabel('something_new')).toBe('something_new')
  })
})


describe('live labels and the summary line', () => {
  it('uses present-tense labels while a step runs', () => {
    expect(activeLabel('retrieve_context')).toBe('Finding tables…')
    expect(activeLabel('generate')).toBe('Writing SQL…')
    expect(activeLabel('validate_sql')).toBe('Checking safety…')
    expect(activeLabel('something_new')).toBe('something_new…')
  })

  const done = (node: string, detail: Record<string, unknown> | null = null) => ({ node, status: 'completed' as const, detail })

  it('counts completed steps, SQL attempts and the reported time', () => {
    const steps = [
      done('input_guard'),
      done('retrieve_context'),
      done('generate', { action: 'sql', attempt: 1 }),
      done('validate_sql'),
      done('cost_check'),
      done('execute', { rowCount: 0 }),
      done('generate', { action: 'sql', attempt: 2 }),
      done('validate_sql'),
      done('cost_check'),
      done('execute', { rowCount: 5 }),
      done('mask_output'),
      { node: 'answer', status: 'started' as const, detail: null },
    ]
    expect(timelineSummary(steps, 3200)).toBe('11 steps · 2 attempts · 3.2 s')
  })

  it('leaves out attempts without SQL and an unknown time', () => {
    expect(timelineSummary([done('input_guard'), done('retrieve_context'), done('generate', { action: 'cannot_answer', attempt: 1 })], null)).toBe(
      '3 steps',
    )
    expect(timelineSummary([done('generate', { action: 'sql', attempt: 1 })], 850)).toBe('1 step · 1 attempt · 850 ms')
  })
})

describe('routeFromHash', () => {
  const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

  it('parses new conversation, conversation and admin routes', () => {
    expect(routeFromHash('')).toEqual({ view: 'chat', conversationId: null })
    expect(routeFromHash('#/')).toEqual({ view: 'chat', conversationId: null })
    expect(routeFromHash(`#/c/${ID}`)).toEqual({ view: 'chat', conversationId: ID })
    expect(routeFromHash(`#/c/${ID.toUpperCase()}/`)).toEqual({ view: 'chat', conversationId: ID })
    expect(routeFromHash('#/admin')).toEqual({ view: 'admin' })
    expect(conversationHash(ID)).toBe(`#/c/${ID}`)
  })

  it('treats a malformed id or an unknown path as a new conversation', () => {
    expect(routeFromHash('#/c/not-an-id')).toEqual({ view: 'chat', conversationId: null })
    expect(routeFromHash(`#/c/${ID}/extra`)).toEqual({ view: 'chat', conversationId: null })
    expect(routeFromHash('#/unknown')).toEqual({ view: 'chat', conversationId: null })
  })

  it('recognises the old History hash for the redirect', () => {
    expect(isLegacyHistoryHash('#/history')).toBe(true)
    expect(isLegacyHistoryHash('#/history/')).toBe(true)
    expect(isLegacyHistoryHash('#/')).toBe(false)
  })
})
