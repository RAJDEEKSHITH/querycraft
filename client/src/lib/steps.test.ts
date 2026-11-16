import { describe, expect, it } from 'vitest'
import { viewFromHash } from './hash-route'
import { isRetry, nodeLabel, stepNote } from './steps'

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

describe('viewFromHash', () => {
  it('maps the three hashes and defaults to Ask', () => {
    expect(viewFromHash('#/history')).toBe('history')
    expect(viewFromHash('#/admin/')).toBe('admin')
    expect(viewFromHash('#/')).toBe('ask')
    expect(viewFromHash('')).toBe('ask')
    expect(viewFromHash('#/unknown')).toBe('ask')
  })
})
