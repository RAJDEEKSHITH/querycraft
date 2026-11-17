import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { conversationTitle } from '../lib/conversation-meta'

// This browser's conversations for the sidebar (IMPLEMENTATION.md 15), persisted to
// localStorage: id, title (first question) and last activity, newest first. Entries saved
// by an earlier version are plain ids; they load with an unknown title and time, which the
// sidebar fetches once and stores. Storage can be missing or throw (private windows,
// blocked site data): the list then lives for this page only. Removing an entry only
// forgets it in this browser; nothing is deleted on the server.

export const HISTORY_KEY = 'querycraft.conversations'
export const HISTORY_MAX = 100

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface HistoryEntry {
  id: string
  /** Null until known (an entry from the id-only format). */
  title: string | null
  /** ISO time of the last question asked; null until known. */
  updatedAt: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toEntry(value: unknown): HistoryEntry | null {
  if (typeof value === 'string') return UUID.test(value) ? { id: value, title: null, updatedAt: null } : null
  if (!isRecord(value)) return null
  const { id, title, updatedAt } = value
  if (typeof id !== 'string' || !UUID.test(id)) return null
  return {
    id,
    title: typeof title === 'string' ? title : null,
    updatedAt: typeof updatedAt === 'string' && !Number.isNaN(new Date(updatedAt).getTime()) ? updatedAt : null,
  }
}

/** Reads the stored entries (newest first); anything unreadable counts as empty. */
export function loadEntries(storage: StorageLike | null): HistoryEntry[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(HISTORY_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const entries: HistoryEntry[] = []
    for (const value of parsed) {
      const entry = toEntry(value)
      if (entry === null || seen.has(entry.id)) continue
      seen.add(entry.id)
      entries.push(entry)
    }
    return entries.slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

/** Writes the entries; returns false when the storage refused. */
export function saveEntries(storage: StorageLike | null, entries: HistoryEntry[]): boolean {
  if (storage === null) return false
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(entries))
    return true
  } catch {
    return false
  }
}

/**
 * Records a question in a conversation: the entry moves to the front with the new time.
 * A new entry takes its title from this (its first) question; a known title is kept.
 */
export function withActivity(entries: HistoryEntry[], id: string, question: string, at: string): HistoryEntry[] {
  const existing = entries.find((e) => e.id === id)
  const title = existing?.title ?? (existing === undefined ? conversationTitle(question) : null)
  return [{ id, title, updatedAt: at }, ...entries.filter((e) => e.id !== id)].slice(0, HISTORY_MAX)
}

/**
 * Fills in the title and time fetched for an entry, keeping its place in the list. A
 * conversation opened by link that this browser did not know yet is added at the end.
 */
export function withMeta(entries: HistoryEntry[], id: string, title: string, updatedAt: string | null): HistoryEntry[] {
  if (!entries.some((e) => e.id === id)) return [...entries, { id, title, updatedAt }].slice(0, HISTORY_MAX)
  return entries.map((e) => (e.id === id ? { ...e, title, updatedAt: updatedAt ?? e.updatedAt } : e))
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export interface HistoryStore {
  entries: HistoryEntry[]
  /** A question was asked in conversation `id` (the first one names it). */
  recordQuestion: (id: string, question: string) => void
  /** Title and last activity fetched from the server (adds a conversation opened by link). */
  setMeta: (id: string, title: string, updatedAt: string | null) => void
  /** Forgets the conversation in this browser only. */
  remove: (id: string) => void
}

export function createHistoryStore(
  storage: StorageLike | null,
  now: () => Date = () => new Date(),
): UseBoundStore<StoreApi<HistoryStore>> {
  return create<HistoryStore>()((set, get) => {
    const commit = (entries: HistoryEntry[]): void => {
      saveEntries(storage, entries)
      set({ entries })
    }
    return {
      entries: loadEntries(storage),
      recordQuestion: (id, question) => {
        commit(withActivity(get().entries, id, question, now().toISOString()))
      },
      setMeta: (id, title, updatedAt) => {
        commit(withMeta(get().entries, id, title, updatedAt))
      },
      remove: (id) => {
        commit(get().entries.filter((e) => e.id !== id))
      },
    }
  })
}

export const useHistoryStore = createHistoryStore(browserStorage())
