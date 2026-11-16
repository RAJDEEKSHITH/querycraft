import { create } from 'zustand'
import { ApiError, errorText } from '../lib/http'
import { createQuestion, rerunQuestion, sendApproval, sendClarification, sendFeedback } from '../lib/questions-api'
import { openQuestionStream } from '../lib/sse'
import type { FeedbackRating } from '../types/api'
import { activeTurn, askReducer, initialAskState, type AskAction, type AskState } from './ask-reducer'
import { useHistoryStore } from './historyStore'

// Ask view state (IMPLEMENTATION.md 15): current conversation, question status,
// streamed steps, pending clarification / approval and the result.

interface AskStore extends AskState {
  /** A request the user started is in flight (disables the matching controls). */
  busy: boolean
  /** Error of the last user action (create, clarify, approve, feedback, rerun). */
  actionError: string | null
  ask: (question: string) => Promise<void>
  answerClarification: (questionId: string, answer: string) => Promise<void>
  decideApproval: (questionId: string, approved: boolean) => Promise<void>
  reconnect: (questionId: string) => void
  rerun: (questionId: string) => Promise<void>
  giveFeedback: (questionId: string, rating: FeedbackRating, comment: string) => Promise<void>
  newConversation: () => void
  dismissError: () => void
}

let closeStream: (() => void) | null = null

export const useAskStore = create<AskStore>()((set, get) => {
  const dispatch = (action: AskAction): void => {
    set((s) => askReducer(s, action))
  }

  const stream = (questionId: string): void => {
    closeStream?.()
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

  return {
    ...initialAskState,
    busy: false,
    actionError: null,

    ask: (question) =>
      action(async () => {
        if (activeTurn(get()) !== null) return
        const created = await createQuestion(question, get().conversationId)
        useHistoryStore.getState().add(created.conversationId)
        dispatch({ type: 'question_created', ...created, question })
        dispatch({ type: 'segment_started', questionId: created.questionId })
        stream(created.questionId)
      }),

    answerClarification: (questionId, answer) =>
      action(async () => {
        await sendClarification(questionId, answer)
        dispatch({ type: 'segment_started', questionId })
        stream(questionId)
      }),

    decideApproval: (questionId, approved) =>
      action(async () => {
        await sendApproval(questionId, approved)
        dispatch({ type: 'segment_started', questionId })
        stream(questionId)
      }),

    reconnect: (questionId) => {
      set({ actionError: null })
      dispatch({ type: 'reconnecting', questionId })
      stream(questionId)
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

    newConversation: () => {
      closeStream?.()
      closeStream = null
      set({ ...initialAskState, actionError: null })
    },

    dismissError: () => {
      set({ actionError: null })
    },
  }
})
