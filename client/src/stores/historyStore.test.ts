import { describe, expect, it } from 'vitest'
import { createHistoryStore, HISTORY_KEY, HISTORY_MAX, loadIds, saveIds, withId, type StorageLike } from './historyStore'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v
    },
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('history persistence', () => {
  it('round-trips ids through storage', () => {
    const storage = memoryStorage()
    expect(saveIds(storage, [A, B])).toBe(true)
    expect(loadIds(storage)).toEqual([A, B])
  })

  it('ignores corrupt or foreign data', () => {
    expect(loadIds(memoryStorage({ [HISTORY_KEY]: 'not json' }))).toEqual([])
    expect(loadIds(memoryStorage({ [HISTORY_KEY]: '{"a":1}' }))).toEqual([])
    expect(loadIds(memoryStorage({ [HISTORY_KEY]: JSON.stringify([A, 'x', 3, A, B]) }))).toEqual([A, B])
  })

  it('survives storage that throws or is missing', () => {
    expect(loadIds(throwing)).toEqual([])
    expect(saveIds(throwing, [A])).toBe(false)
    expect(loadIds(null)).toEqual([])
  })

  it('withId puts the newest first, without duplicates, capped', () => {
    expect(withId([A, B], B)).toEqual([B, A])
    const many = Array.from({ length: HISTORY_MAX }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const next = withId(many, A)
    expect(next).toHaveLength(HISTORY_MAX)
    expect(next[0]).toBe(A)
  })

  it('the store persists add and remove', () => {
    const storage = memoryStorage()
    const store = createHistoryStore(storage)
    store.getState().add(A)
    store.getState().add(B)
    expect(store.getState().ids).toEqual([B, A])
    store.getState().remove(B)
    expect(JSON.parse(storage.data[HISTORY_KEY] ?? '[]')).toEqual([A])
    expect(createHistoryStore(storage).getState().ids).toEqual([A])
  })

  it('the store still works in memory when storage throws', () => {
    const store = createHistoryStore(throwing)
    store.getState().add(A)
    expect(store.getState().ids).toEqual([A])
  })
})
