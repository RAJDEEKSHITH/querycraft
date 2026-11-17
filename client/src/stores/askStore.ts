import { create } from 'zustand'
import { conversationTitle } from '../lib/conversation-meta'
import { ApiError, errorText } from '../lib/http'
import { createQuestion, getConversation, rerunQuestion, sendApproval, sendClarification, sendFeedback } from '../lib/questions-api'
import { openQuestionStream } from '../lib/sse'
import type { FeedbackRating } from '../types/api'
import { activeTurn, askReducer, initialAskState, type AskAction, type AskState } from './ask-reducer'
import { useHistoryStore } from './historyStore'

// Thread state (IMPLEMENTATION.md 15): the current conversation and its turns (status,
// streamed steps, pending clarification / approval, outcome). A stored conversation is
// opened from GET /api/conversations/:id; a question still running is followed again.

export interface LoadError {
  conversationId: string
  message: string
  /** The server no longer has this conversation (offer to remove it from history). */
  notFound: boolean
}

interface AskStore extends AskState {
  /** A request the user started is in flight (disables the matching controls). */
  busy: boolean
  /** Error of the last user action (create, clarify, approve, feedback, rerun). */
  actionError: string | null
  /** Conversation being opened, if any. */
  loading: string | null
  loadError: LoadError | null
  /** Follows the route: null = new conversation, an id = open that conversation. */
  openRoute: (conversationId: string | null) => Promise<void>
  ask: (question: string) => Promise<void>
  answerClarification: (questionId: string, answer: string) => Promise<void>
  decideApproval: (questionId: string, approved: boolean) => Promise<void>
  reconnect: (questionId: string) => void
  stopWaiting: (questionId: string) => void
  rerun: (questionId: string) => Promise<void>
  giveFeedback: (questionId: string, rating: FeedbackRating, comment: string) => Promise<void>
  newConversation: () => void
  dismissError: () => void
}

let closeStream: (() => void) | null = null
/** Increases with every open / reset, so a slow response for an old route is ignored. */
let loadSeq = 0

function stopStream(): void {
  closeStream?.()
  closeStream = null
}

export const useAskStore = create<AskStore>()((set, get) => {
  const dispatch = (action: AskAction): void => {
    set((s) => askReducer(s, action))
  }

  const stream = (questionId: string): void => {
    stopStream()
    closeStream = openQuestionStream(questionId, {
      onEvent: (event) => {
        dispatch({ type: 'event', questionId, event })
      },
      onReplay: () => {
        dispatch({ type: 'stream_replayed', questionId })
      },
      onFailure: (message) => {
        dispatch({ type: 'stream_failed', questionId, message })
      },
    })
  }

  /** Runs one user action with the shared busy flag and error message. */
  const action = async (run: () => Promise<void>): Promise<void> => {
    if (get().busy) return
    set({ busy: true, actionError: null })
    try {
      await run()
    } catch (err) {
      set({ actionError: errorText(err) })
    } finally {
      set({ busy: false })
    }
  }

  const reset = (): void => {
    stopStream()
    loadSeq += 1
    set({ ...initialAskState, actionError: null, loading: null, loadError: null })
  }

  const open = async (conversationId: string): Promise<void> => {
    stopStream()
    loadSeq += 1
    const seq = loadSeq
    set({ ...initialAskState, actionError: null, loading: conversationId, loadError: null })
    try {
      const conversation = await getConversation(conversationId)
      if (seq !== loadSeq) return
      dispatch({ type: 'conversation_loaded', conversationId, questions: conversation.questions })
      set({ loading: null })
      const first = conversation.questions[0]
      const last = conversation.questions.at(-1)
      useHistoryStore.getState().setMeta(conversationId, conversationTitle(first?.question), last?.createdAt ?? conversation.createdAt)
      // A question still running on the server: follow it again (the server replays its segment).
      if (last?.status === 'running') {
        dispatch({ type: 'reconnecting', questionId: last.id })
        stream(last.id)
      }
    } catch (err) {
      if (seq !== loadSeq) return
      set({
        loading: null,
        loadError: { conversationId, message: errorText(err), notFound: err instanceof ApiError && err.code === 'NOT_FOUND' },
      })
    }
  }

  return {
    ...initialAskState,
    busy: false,
    actionError: null,
    loading: null,
    loadError: null,

    openRoute: async (conversationId) => {
      const s = get()
      if (conversationId === null) {
        if (s.conversationId !== null || s.turns.length > 0 || s.loading !== null || s.loadError !== null) reset()
        return
      }
      // Already shown (for example right after its first question) or already opening.
      if (s.loading === conversationId) return
      if (s.conversationId === conversationId && s.loadError === null) return
      await open(conversationId)
    },

    ask: (question) =>
      action(async () => {
        if (activeTurn(get()) !== null) return
        const created = await createQuestion(question, get().conversationId)
        useHistoryStore.getState().recordQuestion(created.conversationId, question)
        set({ loadError: null })
        dispatch({ type: 'question_created', ...created, question })
        dispatch({ type: 'segment_started', questionId: created.questionId })
        stream(created.questionId)
      }),

    answerClarification: (questionId, answer) =>
      action(async () => {
        const question = get().turns.find((t) => t.questionId === questionId)?.clarification?.question ?? ''
        await sendClarification(questionId, answer)
        dispatch({ type: 'exchange_added', questionId, exchange: { kind: 'clarification', question, answer } })
        dispatch({ type: 'segment_started', questionId })
        stream(questionId)
      }),

    decideApproval: (questionId, approved) =>
      action(async () => {
        const estimatedCost = get().turns.find((t) => t.questionId === questionId)?.approval?.estimatedCost ?? 0
        await sendApproval(questionId, approved)
        dispatch({ type: 'exchange_added', questionId, exchange: { kind: 'approval', estimatedCost, approved } })
        dispatch({ type: 'segment_started', questionId })
        stream(questionId)
      }),

    reconnect: (questionId) => {
      set({ actionError: null })
      dispatch({ type: 'reconnecting', questionId })
      stream(questionId)
    },

    stopWaiting: (questionId) => {
      // Client only: the stream closes, the server run goes on (IMPLEMENTATION.md 15).
      stopStream()
      dispatch({ type: 'stop_waiting', questionId })
    },

    rerun: (questionId) =>
      action(async () => {
        const result = await rerunQuestion(questionId)
        if (result.status === 'blocked') throw new ApiError('INVALID_STATE', `Re-run blocked by ${result.rule}: ${result.message}`)
        dispatch({ type: 'rerun_rows', questionId, columns: result.columns, rows: result.rows, truncated: result.truncated })
      }),

    giveFeedback: (questionId, rating, comment) =>
      action(async () => {
        const result = await sendFeedback(questionId, rating, comment)
        dispatch({ type: 'feedback_sent', questionId, rating, exampleCreated: result.exampleId !== null })
      }),

    newConversation: reset,

    dismissError: () => {
      set({ actionError: null })
    },
  }
})
