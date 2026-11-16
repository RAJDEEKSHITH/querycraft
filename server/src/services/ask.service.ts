import { and, eq } from 'drizzle-orm'
import { getAppDb } from '../db/app.js'
import { auditEvents, questions, type StoredColumn } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import {
  claimApproval,
  claimClarification,
  continueRun,
  createQuestion,
  markRunFailed,
  runQuestion,
  type QuestionDeps,
  type RunOutcome,
  type StepListener,
} from './question.service.js'
import type { EventListener, QuestionEvent, QuestionEventBus } from './question-events.js'
import { assertQuestionExists, liveFinalEvents, storedEvents } from './question-view.service.js'
import { runSafeQuery } from './safe-query.service.js'
import { assertWithinBudget } from './usage.service.js'

// The public question flow behind the HTTP API (IMPLEMENTATION.md 14.1, 14.3):
// requests are checked and the question is claimed synchronously (so 400 / 404 /
// 409 / 503 reach the caller), then the run segment continues in the background
// and streams its events through the in-memory bus.

export interface AskContext {
  deps: QuestionDeps
  bus: QuestionEventBus
}

/** Runs one segment in the background; its events go to the bus, ending with `done`. */
function runInBackground(questionId: string, ctx: AskContext, run: (onStep: StepListener) => Promise<RunOutcome>): void {
  ctx.bus.start(questionId)
  const onStep: StepListener = (event) => {
    ctx.bus.publish(questionId, { event: 'step', data: event })
  }
  const finish = async (): Promise<void> => {
    try {
      const outcome = await run(onStep)
      for (const event of await liveFinalEvents(questionId, outcome, ctx.deps)) ctx.bus.publish(questionId, event)
    } catch (err) {
      // Failures inside the graph are recorded by the question service; this is a
      // failure around it (for example the app database), so the record is fixed here.
      ctx.deps.logger?.error({ err, questionId }, 'background question run failed')
      await markRunFailed(questionId, 'INTERNAL_ERROR').catch((markErr: unknown) => {
        ctx.deps.logger?.error({ err: markErr, questionId }, 'could not mark the question failed')
      })
      ctx.bus.publish(questionId, { event: 'error', data: { code: 'INTERNAL_ERROR', message: 'The question could not be processed.' } })
      ctx.bus.publish(questionId, { event: 'done', data: { status: 'failed' } })
    }
  }
  void finish()
}

export async function startQuestion(
  input: { question: string; conversationId?: string | undefined },
  ctx: AskContext,
): Promise<{ questionId: string; conversationId: string }> {
  await assertWithinBudget('app')
  const created = await createQuestion(input)
  runInBackground(created.questionId, ctx, (onStep) => runQuestion(created.questionId, { source: 'app', onStep }, ctx.deps))
  return created
}

export async function answerClarification(questionId: string, answer: string, ctx: AskContext): Promise<void> {
  const claimed = await claimClarification(questionId, answer)
  runInBackground(questionId, ctx, (onStep) => continueRun(claimed, ctx.deps, onStep))
}

export async function decideApproval(questionId: string, approved: boolean, ctx: AskContext): Promise<void> {
  const claimed = await claimApproval(questionId, approved)
  runInBackground(questionId, ctx, (onStep) => continueRun(claimed, ctx.deps, onStep))
}

/**
 * Delivers a question's events to `listener`: the active segment's buffered and
 * live events, or (late connect, 14.3) the final events from the stored record.
 * Every stream ends with `done`. Returns a function that stops delivery.
 */
export async function openEventStream(questionId: string, ctx: AskContext, listener: EventListener): Promise<() => void> {
  await assertQuestionExists(questionId)
  const live = ctx.bus.subscribe(questionId, listener)
  if (live !== null) {
    for (const event of live.replay) listener(event)
    return live.unsubscribe
  }
  const events: QuestionEvent[] = await storedEvents(questionId, ctx.deps)
  for (const event of events) listener(event)
  return () => undefined
}

export type RerunResult =
  | { status: 'executed'; columns: StoredColumn[]; rows: unknown[][]; rowCount: number; truncated: boolean }
  | { status: 'blocked'; stage: string; rule: string; message: string }

/**
 * Re-executes an answered question's final SQL through the full safety pipeline
 * (10.3: rows are never stored). Above the soft limit it runs only if this
 * question's audit trail shows the user approved it (COST_APPROVED, recorded
 * again); otherwise it is blocked. The hard limit always blocks.
 */
export async function rerunQuestion(questionId: string): Promise<RerunResult> {
  const db = getAppDb()
  const [row] = await db
    .select({ status: questions.status, finalSql: questions.finalSql })
    .from(questions)
    .where(eq(questions.id, questionId))
  if (row === undefined) throw new AppError('NOT_FOUND', 'Question not found')
  if (row.status !== 'answered' || row.finalSql === null) {
    throw new AppError('INVALID_STATE', 'Only answered questions can be re-run')
  }
  const [approved] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(eq(auditEvents.questionId, questionId), eq(auditEvents.rule, 'COST_APPROVED')))
    .limit(1)
  const result = await runSafeQuery({
    sql: row.finalSql,
    source: 'app',
    questionId,
    softLimit: approved === undefined ? 'block' : 'allow',
  })
  if (result.status === 'executed') {
    return {
      status: 'executed',
      columns: result.columns.map((c) => ({ name: c.name, type: c.type })),
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
    }
  }
  if (result.status === 'blocked') {
    return { status: 'blocked', stage: result.stage, rule: result.rule, message: result.message }
  }
  // Unreachable: neither `block` nor `allow` asks for approval.
  throw new AppError('INTERNAL_ERROR', 'Internal server error', { cause: new Error('rerun asked for approval') })
}
