import { eq } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { examples, feedback, feedbackRating, questions } from '../db/schema.js'
import { AppError } from '../lib/errors.js'

// Feedback (F13, IMPLEMENTATION.md 14.1): one rating per finished question. `up` on
// an answered question creates a *pending* example; only the admin can verify it,
// so nothing from feedback reaches a prompt on its own (D18).

export type FeedbackRating = (typeof feedbackRating.enumValues)[number]

const FINISHED = new Set(['answered', 'blocked', 'cannot_answer', 'failed', 'cancelled'])

export async function submitFeedback(
  questionId: string,
  input: { rating: FeedbackRating; comment?: string | undefined },
): Promise<{ feedbackId: string; exampleId: string | null }> {
  return getAppDb().transaction(async (tx) => {
    const [question] = await tx
      .select({ status: questions.status, question: questions.question, finalSql: questions.finalSql })
      .from(questions)
      .where(eq(questions.id, questionId))
      .for('update')
    if (question === undefined) throw new AppError('NOT_FOUND', 'Question not found')
    if (!FINISHED.has(question.status)) throw new AppError('INVALID_STATE', 'Feedback is accepted once the question has finished')
    const [created] = await tx
      .insert(feedback)
      .values({ questionId, rating: input.rating, comment: input.comment ?? null })
      .onConflictDoNothing({ target: feedback.questionId })
      .returning({ id: feedback.id })
    if (created === undefined) throw new AppError('INVALID_STATE', 'This question already has feedback')
    if (input.rating !== 'up' || question.status !== 'answered' || question.finalSql === null) {
      return { feedbackId: created.id, exampleId: null }
    }
    const [example] = await tx
      .insert(examples)
      .values({ question: question.question, sql: question.finalSql, status: 'pending', source: 'feedback' })
      .returning({ id: examples.id })
    if (example === undefined) throw new Error('example not created')
    return { feedbackId: created.id, exampleId: example.id }
  })
}
