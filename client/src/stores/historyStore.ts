import { create, type StoreApi, type UseBoundStore } from 'zustand'

// Conversation ids of this browser, persisted to localStorage (IMPLEMENTATION.md 15).
// Storage can be missing or throw (private windows, blocked site data): the list then
// lives for this page only.

export const HISTORY_KEY = 'querycraft.conversations'
export const HISTORY_MAX = 100

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads the stored ids (newest first); anything unreadable counts as empty. */
export function loadIds(storage: StorageLike | null): string[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(HISTORY_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const ids = parsed.filter((v): v is string => typeof v === 'string' && UUID.test(v))
    return [...new Set(ids)].slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

/** Writes the ids; returns false when the storage refused. */
export function saveIds(storage: StorageLike | null, ids: string[]): boolean {
  if (storage === null) return false
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(ids))
    return true
  } catch {
    return false
  }
}

/** Adds an id at the front (moving it if present), capped at HISTORY_MAX. */
export function withId(ids: string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, HISTORY_MAX)
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export interface HistoryStore {
  ids: string[]
  add: (id: string) => void
  remove: (id: string) => void
}

export function createHistoryStore(storage: StorageLike | null): UseBoundStore<StoreApi<HistoryStore>> {
  return create<HistoryStore>()((set, get) => ({
    ids: loadIds(storage),
    add: (id) => {
      const ids = withId(get().ids, id)
      saveIds(storage, ids)
      set({ ids })
    },
    remove: (id) => {
      const ids = get().ids.filter((x) => x !== id)
      saveIds(storage, ids)
      set({ ids })
    },
  }))
}

export const useHistoryStore = createHistoryStore(browserStorage())
