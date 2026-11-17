import { describe, expect, it } from 'vitest'
import {
  createHistoryStore,
  HISTORY_KEY,
  HISTORY_MAX,
  loadEntries,
  saveEntries,
  withActivity,
  withMeta,
  type HistoryEntry,
  type StorageLike,
} from './historyStore'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const T1 = '2026-11-17T09:00:00.000Z'
const T2 = '2026-11-17T10:00:00.000Z'

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

const entry = (id: string, title: string | null = 'Q', updatedAt: string | null = T1): HistoryEntry => ({ id, title, updatedAt })

describe('history persistence', () => {
  it('round-trips entries through storage', () => {
    const storage = memoryStorage()
    expect(saveEntries(storage, [entry(A), entry(B, null, null)])).toBe(true)
    expect(loadEntries(storage)).toEqual([entry(A), entry(B, null, null)])
  })

  it('migrates the id-only format: unknown title and time', () => {
    const storage = memoryStorage({ [HISTORY_KEY]: JSON.stringify([A, B]) })
    expect(loadEntries(storage)).toEqual([entry(A, null, null), entry(B, null, null)])
  })

  it('ignores corrupt or foreign data, duplicates and bad fields', () => {
    expect(loadEntries(memoryStorage({ [HISTORY_KEY]: 'not json' }))).toEqual([])
    expect(loadEntries(memoryStorage({ [HISTORY_KEY]: '{"a":1}' }))).toEqual([])
    const mixed = [A, 'x', 3, { id: 'nope' }, { id: A, title: 'dup' }, { id: B, title: 7, updatedAt: 'not a date' }]
    expect(loadEntries(memoryStorage({ [HISTORY_KEY]: JSON.stringify(mixed) }))).toEqual([entry(A, null, null), entry(B, null, null)])
  })

  it('survives storage that throws or is missing', () => {
    expect(loadEntries(throwing)).toEqual([])
    expect(saveEntries(throwing, [entry(A)])).toBe(false)
    expect(loadEntries(null)).toEqual([])
  })
})

describe('history updates', () => {
  it('a first question names a new conversation; later ones keep the title and move it to the front', () => {
    let entries = withActivity([], A, 'How many customers do we have?', T1)
    entries = withActivity(entries, B, 'Top 5 products', T1)
    entries = withActivity(entries, A, 'and the year before?', T2)
    expect(entries).toEqual([entry(A, 'How many customers do we have?', T2), entry(B, 'Top 5 products', T1)])
  })

  it('an old entry without a title stays untitled until its metadata is fetched', () => {
    const entries = withActivity([entry(A, null, null)], A, 'follow-up', T2)
    expect(entries).toEqual([entry(A, null, T2)])
    expect(withMeta(entries, A, 'First question', T1)).toEqual([entry(A, 'First question', T1)])
    expect(withMeta([entry(A, null, T2)], A, 'First question', null)).toEqual([entry(A, 'First question', T2)])
  })

  it('a conversation opened by link is added at the end', () => {
    expect(withMeta([entry(A)], B, 'Linked', T2)).toEqual([entry(A), entry(B, 'Linked', T2)])
  })

  it('caps the list at HISTORY_MAX', () => {
    const many = Array.from({ length: HISTORY_MAX }, (_, i) => entry(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
    const next = withActivity(many, A, 'new', T2)
    expect(next).toHaveLength(HISTORY_MAX)
    expect(next[0]?.id).toBe(A)
  })

  it('the store persists questions, metadata and removal', () => {
    const storage = memoryStorage()
    const store = createHistoryStore(storage, () => new Date(T1))
    store.getState().recordQuestion(A, 'First')
    store.getState().recordQuestion(B, 'Second')
    expect(store.getState().entries.map((e) => e.id)).toEqual([B, A])
    store.getState().remove(B)
    expect(JSON.parse(storage.data[HISTORY_KEY] ?? '[]')).toEqual([entry(A, 'First', T1)])
    store.getState().setMeta(A, 'Renamed from server', T2)
    expect(createHistoryStore(storage).getState().entries).toEqual([entry(A, 'Renamed from server', T2)])
  })

  it('the store still works in memory when storage throws', () => {
    const store = createHistoryStore(throwing, () => new Date(T1))
    store.getState().recordQuestion(A, 'First')
    expect(store.getState().entries).toEqual([entry(A, 'First', T1)])
  })
})
