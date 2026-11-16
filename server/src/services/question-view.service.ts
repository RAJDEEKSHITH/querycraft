import { asc, eq } from 'drizzle-orm'
import type { ApprovalRequest, ClarificationRequest } from '../agent/graph.js'
import { getAppDb } from '../db/app.js'
import { conversations, questions, type StoredColumn, type TraceEntry } from '../db/schema.js'
import { AppError } from '../lib/errors.js'
import { checkpointOutcome, type CheckpointOutcome, type QuestionDeps, type RunOutcome } from './question.service.js'
import type { AnswerEventData, QuestionEvent } from './question-events.js'

// Question records for the API (IMPLEMENTATION.md 14.1) and the final SSE events
// (14.3). Result rows are never stored, so a record has columns and a row count
// only; viewing an old result again goes through rerun (10.3).

type QuestionRow = typeof questions.$inferSelect

export interface QuestionView {
  id: string
  conversationId: string
  question: string
  status: QuestionRow['status']
  sql: string | null
  answer: string | null
  explanation: string | null
  tablesUsed: string[]
  assumptions: string[]
  columns: StoredColumn[]
  rowCount: number | null
  truncated: boolean | null
  attempts: number
  trace: TraceEntry[]
  errorCode: string | null
  tokens: { prompt: number; completion: number; embedding: number }
  costUsd: string
  latencyMs: number | null
  createdAt: string
  completedAt: string | null
  /** Pending request of a paused question, from its checkpoint. */
  clarification: ClarificationRequest | null
  approval: ApprovalRequest | null
  /** Why the agent could not answer (`cannot_answer`). */
  reason: string | null
  blocked: { stage: string; rule: string; message: string } | null
  error: { code: string; message: string } | null
}

export interface ConversationView {
  id: string
  createdAt: string
  questions: QuestionView[]
}

const FAILURE_MESSAGES: Record<string, string> = {
  BUDGET_EXCEEDED: 'The daily usage limit has been reached. Please try again tomorrow.',
  UPSTREAM_RATE_LIMITED: 'The language model provider is busy. Please try again shortly.',
  INTERRUPTED: 'The server restarted while this question was running.',
}

function failure(row: QuestionRow, outcome: CheckpointOutcome | null): { code: string; message: string } {
  const code = row.errorCode ?? 'INTERNAL_ERROR'
  if (outcome?.status === 'failed' && outcome.errorCode === code) return { code, message: outcome.message }
  return { code, message: FAILURE_MESSAGES[code] ?? 'The question could not be answered.' }
}

function toView(row: QuestionRow, outcome: CheckpointOutcome | null): QuestionView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    question: row.question,
    status: row.status,
    sql: row.finalSql,
    answer: row.answer,
    explanation: row.explanation,
    tablesUsed: row.tablesUsed ?? [],
    assumptions: row.assumptions ?? [],
    columns: row.resultColumns ?? [],
    rowCount: row.rowCount,
    truncated: row.truncated,
    attempts: row.attempts,
    trace: row.trace,
    errorCode: row.errorCode,
    tokens: { prompt: row.promptTokens, completion: row.completionTokens, embedding: row.embeddingTokens },
    costUsd: row.costUsd,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    clarification:
      row.status === 'awaiting_clarification' && outcome?.status === 'awaiting_clarification' ? outcome.clarification : null,
    approval: row.status === 'awaiting_approval' && outcome?.status === 'awaiting_approval' ? outcome.approval : null,
    reason: row.status === 'cannot_answer' && outcome?.status === 'cannot_answer' ? outcome.reason : null,
    blocked:
      row.status === 'blocked' && outcome?.status === 'blocked'
        ? { stage: outcome.stage, rule: outcome.rule, message: outcome.message }
        : null,
    error: row.status === 'failed' ? failure(row, outcome) : null,
  }
}

async function questionRow(questionId: string): Promise<QuestionRow> {
  const [row] = await getAppDb().select().from(questions).where(eq(questions.id, questionId))
  if (row === undefined) throw new AppError('NOT_FOUND', 'Question not found')
  return row
}

async function viewOf(row: QuestionRow, deps: QuestionDeps): Promise<QuestionView> {
  // A running question has no final checkpoint outcome yet.
  const outcome = row.status === 'running' ? null : await checkpointOutcome(row.id, deps)
  return toView(row, outcome)
}

export async function getQuestionView(questionId: string, deps: QuestionDeps): Promise<QuestionView> {
  return viewOf(await questionRow(questionId), deps)
}

export async function getConversationView(conversationId: string, deps: QuestionDeps): Promise<ConversationView> {
  const db = getAppDb()
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId))
  if (conversation === undefined) throw new AppError('NOT_FOUND', 'Conversation not found')
  const rows = await db
    .select()
    .from(questions)
    .where(eq(questions.conversationId, conversationId))
    .orderBy(asc(questions.createdAt))
  const views: QuestionView[] = []
  for (const row of rows) views.push(await viewOf(row, deps))
  return { id: conversation.id, createdAt: conversation.createdAt.toISOString(), questions: views }
}

function answerData(view: QuestionView, rows: unknown[][] | null): AnswerEventData {
  return {
    answer: view.answer ?? '',
    explanation: view.explanation ?? '',
    sql: view.sql ?? '',
    tablesUsed: view.tablesUsed,
    assumptions: view.assumptions,
    columns: view.columns,
    rows,
    rowCount: view.rowCount ?? 0,
    truncated: view.truncated ?? false,
    tokens: view.tokens,
    latencyMs: view.latencyMs,
  }
}

/** Final events of a segment from the stored record (late connect); `rows` only from a live run. */
function eventsFromView(view: QuestionView, rows: unknown[][] | null): QuestionEvent[] {
  const events: QuestionEvent[] = []
  if (view.clarification !== null) events.push({ event: 'clarification_required', data: view.clarification })
  if (view.approval !== null) events.push({ event: 'approval_required', data: view.approval })
  if (view.status === 'answered') events.push({ event: 'answer', data: answerData(view, rows) })
  if (view.reason !== null) events.push({ event: 'cannot_answer', data: { reason: view.reason } })
  if (view.blocked !== null) events.push({ event: 'blocked', data: view.blocked })
  if (view.error !== null) events.push({ event: 'error', data: view.error })
  if (view.status === 'running') {
    events.push({ event: 'error', data: { code: 'INVALID_STATE', message: 'The run is not active on this server.' } })
  }
  events.push({ event: 'done', data: { status: view.status } })
  return events
}

/** Events for a client that connects when no segment is active (14.3 late connect). */
export async function storedEvents(questionId: string, deps: QuestionDeps): Promise<QuestionEvent[]> {
  return eventsFromView(await getQuestionView(questionId, deps), null)
}

/** Final events of a live segment: the stored record (tokens, latency) plus the masked rows. */
export async function liveFinalEvents(questionId: string, outcome: RunOutcome, deps: QuestionDeps): Promise<QuestionEvent[]> {
  const view = await getQuestionView(questionId, deps)
  return eventsFromView(view, outcome.status === 'answered' ? outcome.rows : null)
}

/** Throws NOT_FOUND unless the question exists. */
export async function assertQuestionExists(questionId: string): Promise<void> {
  const [row] = await getAppDb().select({ id: questions.id }).from(questions).where(eq(questions.id, questionId))
  if (row === undefined) throw new AppError('NOT_FOUND', 'Question not found')
}
