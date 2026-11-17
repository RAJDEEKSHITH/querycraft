import { useEffect } from 'react'
import { create } from 'zustand'
import { conversationTitle } from '../../lib/conversation-meta'
import { getConversation } from '../../lib/questions-api'
import { useHistoryStore } from '../../stores/historyStore'

// Entries saved before titles were cached (plain ids) get their title and last activity
// from the server once, one request at a time; the result is stored in history.

interface BackfillState {
  /** Ids whose fetch failed (not found or unreachable): shown untitled, not retried this page. */
  failed: string[]
  markFailed: (id: string) => void
}

export const useBackfillState = create<BackfillState>()((set) => ({
  failed: [],
  markFailed: (id) => {
    set((s) => ({ failed: [...s.failed, id] }))
  },
}))

const attempted = new Set<string>()

/** Mount once (App): fetches the missing titles in order. */
export function useBackfillTitles(): void {
  // A string, so the selector result is stable between renders.
  const missing = useHistoryStore((s) =>
    s.entries
      .filter((e) => e.title === null)
      .map((e) => e.id)
      .join(','),
  )

  useEffect(() => {
    let cancelled = false
    const ids = missing === '' ? [] : missing.split(',').filter((id) => !attempted.has(id))
    const run = async (): Promise<void> => {
      for (const id of ids) {
        if (cancelled) return
        attempted.add(id)
        try {
          const conversation = await getConversation(id)
          const last = conversation.questions.at(-1)
          useHistoryStore.getState().setMeta(id, conversationTitle(conversation.questions[0]?.question), last?.createdAt ?? conversation.createdAt)
        } catch {
          useBackfillState.getState().markFailed(id)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [missing])
}
