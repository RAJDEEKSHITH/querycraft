import { z } from 'zod'
import { getEnv } from '../../config/env.js'

// Request schemas for the public endpoints (IMPLEMENTATION.md 14.1).

const id = z.uuid()

/** Non-empty after trimming and at most QUESTION_MAX_LENGTH characters (read at request time). */
const userText = z
  .string()
  .refine((s) => s.trim().length > 0, 'must not be empty')
  .refine((s) => s.length <= getEnv().QUESTION_MAX_LENGTH, 'is too long')

export const questionIdInput = z.object({ params: z.object({ id }) })

export const conversationIdInput = z.object({ params: z.object({ id }) })

export const createQuestionInput = z.object({
  body: z.strictObject({ question: userText, conversationId: id.optional() }),
})

export const clarificationInput = z.object({
  params: z.object({ id }),
  body: z.strictObject({ answer: userText }),
})

export const approvalInput = z.object({
  params: z.object({ id }),
  body: z.strictObject({ approved: z.boolean() }),
})

export const FEEDBACK_COMMENT_MAX = 1000

export const feedbackInput = z.object({
  params: z.object({ id }),
  body: z.strictObject({ rating: z.enum(['up', 'down']), comment: z.string().max(FEEDBACK_COMMENT_MAX).optional() }),
})
