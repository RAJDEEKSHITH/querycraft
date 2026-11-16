import type { RequestHandler, Response } from 'express'
import {
  answerClarification,
  decideApproval,
  openEventStream,
  rerunQuestion,
  startQuestion,
  type AskContext,
} from '../../services/ask.service.js'
import { submitFeedback } from '../../services/feedback.service.js'
import type { QuestionEvent } from '../../services/question-events.js'
import { getConversationView, getQuestionView } from '../../services/question-view.service.js'
import { validated } from '../middleware/validate.js'
import {
  approvalInput,
  clarificationInput,
  conversationIdInput,
  createQuestionInput,
  feedbackInput,
  questionIdInput,
} from '../schemas/questions.js'

// Public question endpoints (IMPLEMENTATION.md 14.1, 14.3). Each handler reads the
// validated input, calls one service and sends the response.

export const SSE_HEARTBEAT_MS = 15_000

export interface QuestionHandlers {
  create: RequestHandler
  events: RequestHandler
  get: RequestHandler
  rerun: RequestHandler
  clarification: RequestHandler
  approval: RequestHandler
  feedback: RequestHandler
  conversation: RequestHandler
}

/** Writes one SSE frame; the stream headers are sent before the first frame. */
function sseWriter(res: Response, onEnd: () => void): (event: QuestionEvent) => void {
  let open = false
  return (event) => {
    if (res.writableEnded) return
    if (!open) {
      open = true
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()
    }
    res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`)
    if (event.event === 'done') {
      res.end()
      onEnd()
    }
  }
}

export function questionHandlers(ctx: AskContext): QuestionHandlers {
  return {
    create: validated(createQuestionInput, async ({ body }, _req, res) => {
      res.status(202).json(await startQuestion(body, ctx))
    }),

    events: validated(questionIdInput, async ({ params }, req, res) => {
      let stop: (() => void) | undefined
      let ended = false
      const heartbeat = setInterval(() => {
        if (res.headersSent && !res.writableEnded) res.write(': heartbeat\n\n')
      }, SSE_HEARTBEAT_MS)
      const cleanup = (): void => {
        ended = true
        clearInterval(heartbeat)
        stop?.()
      }
      req.on('close', cleanup)
      try {
        stop = await openEventStream(params.id, ctx, sseWriter(res, cleanup))
      } catch (err) {
        cleanup()
        throw err
      }
      if (ended) stop()
    }),

    get: validated(questionIdInput, async ({ params }, _req, res) => {
      res.json(await getQuestionView(params.id, ctx.deps))
    }),

    rerun: validated(questionIdInput, async ({ params }, _req, res) => {
      res.json(await rerunQuestion(params.id))
    }),

    clarification: validated(clarificationInput, async ({ params, body }, _req, res) => {
      await answerClarification(params.id, body.answer, ctx)
      res.status(202).json({ questionId: params.id })
    }),

    approval: validated(approvalInput, async ({ params, body }, _req, res) => {
      await decideApproval(params.id, body.approved, ctx)
      res.status(202).json({ questionId: params.id })
    }),

    feedback: validated(feedbackInput, async ({ params, body }, _req, res) => {
      res.status(201).json(await submitFeedback(params.id, body))
    }),

    conversation: validated(conversationIdInput, async ({ params }, _req, res) => {
      res.json(await getConversationView(params.id, ctx.deps))
    }),
  }
}
