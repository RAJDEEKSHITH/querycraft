import { describe, expect, it } from 'vitest'
import { conversationTitle, dayGroup, groupByDay, TITLE_MAX, UNTITLED } from './conversation-meta'

describe('conversationTitle', () => {
  it('uses the first question on one line', () => {
    expect(conversationTitle('  How many\n customers   do we have? ')).toBe('How many customers do we have?')
  })

  it('falls back for an empty question', () => {
    expect(conversationTitle('')).toBe(UNTITLED)
    expect(conversationTitle('   ')).toBe(UNTITLED)
    expect(conversationTitle(null)).toBe(UNTITLED)
  })

  it('cuts a long question at a word boundary with an ellipsis', () => {
    const long = 'Which 10 pairs of products are most often bought together in the same order? Show both product names and how often.'
    const title = conversationTitle(long)
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX)
    expect(title.endsWith('…')).toBe(true)
    expect(long.startsWith(title.slice(0, -1))).toBe(true)
    expect(title).not.toMatch(/\s…$/)
  })

  it('cuts one long word mid-word instead of dropping most of it', () => {
    expect(conversationTitle('x'.repeat(200))).toBe(`${'x'.repeat(TITLE_MAX - 1)}…`)
  })
})

describe('dayGroup (local calendar days)', () => {
  const now = new Date(2026, 10, 17, 9, 30) // 17 Nov 2026, 09:30 local time
  const at = (d: number, h = 12, m = 0): string => new Date(2026, 10, d, h, m).toISOString()

  it('splits at local midnight', () => {
    expect(dayGroup(at(17, 0, 0), now)).toBe('Today')
    expect(dayGroup(at(16, 23, 59), now)).toBe('Yesterday')
    expect(dayGroup(at(16, 0, 0), now)).toBe('Yesterday')
  })

  it('previous 7 days covers 2 to 7 days back', () => {
    expect(dayGroup(at(15), now)).toBe('Previous 7 days')
    expect(dayGroup(at(10), now)).toBe('Previous 7 days')
    expect(dayGroup(at(9), now)).toBe('Older')
  })

  it('unknown, invalid and future times', () => {
    expect(dayGroup(null, now)).toBe('Older')
    expect(dayGroup('not a date', now)).toBe('Older')
    expect(dayGroup(at(18), now)).toBe('Today')
  })
})

describe('groupByDay', () => {
  const now = new Date(2026, 10, 17, 9, 30)
  const at = (d: number, h = 12): string => new Date(2026, 10, d, h).toISOString()

  it('orders groups and items newest first and leaves out empty groups', () => {
    const items = [
      { id: 'old', updatedAt: at(1) },
      { id: 'today-early', updatedAt: at(17, 1) },
      { id: 'unknown', updatedAt: null },
      { id: 'today-late', updatedAt: at(17, 8) },
      { id: 'week', updatedAt: at(12) },
    ]
    const groups = groupByDay(items, now)
    expect(groups.map((g) => g.group)).toEqual(['Today', 'Previous 7 days', 'Older'])
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['today-late', 'today-early'], ['week'], ['old', 'unknown']])
  })

  it('returns no groups for no items', () => {
    expect(groupByDay([], now)).toEqual([])
  })
})
