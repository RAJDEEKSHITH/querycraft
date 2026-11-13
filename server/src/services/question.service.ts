import { Command, type BaseCheckpointSaver } from '@langchain/langgraph'
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getCheckpointer } from '../agent/checkpointer.js'
import { buildAgentGraph, stripControlCharacters, type ApprovalRequest, type ClarificationRequest } from '../agent/graph.js'
import { createGroqLlmClient, type LlmClient } from '../agent/llm.js'
import { FULL_FLAGS, type AgentFlags, type ConversationTurn } from '../agent/state.js'
import { getEnv } from '../config/env.js'
import { getAppDb } from '../db/app.js'
import { conversations, questions, type StoredColumn } from '../db/schema.js'
import { llmCostMicroUsd, microUsdToNumeric } from '../lib/cost.js'
import { AppError } from '../lib/errors.js'
import type { Logger } from '../lib/logger.js'
import { createGeminiEmbeddingsClient, type EmbeddingsClient } from '../retrieval/embeddings.js'
import type { RequestSource } from './audit.service.js'

// Runs questions through the agent graph and keeps the `questions` row current
// (IMPLEMENTATION.md 10.3, 12.6): status, final SQL, answer, trace, attempts,
// tokens, cost and latency. A run segment ends at an interrupt (clarification or
// approval) or at the end of the graph; a paused run resumes in a new graph
// instance from the Postgres checkpoint. Result rows are returned to the caller
// and never stored.

export interface QuestionDeps {
  llm: LlmClient
  embeddings: EmbeddingsClient
  checkpointer: BaseCheckpointSaver
  logger?: Logger | undefined
}

/** Real Groq + Gemini clients and the Postgres checkpointer. */
export async function createQuestionDeps(logger?: Logger): Promise<QuestionDeps> {
  return {
    llm: createGroqLlmClient({ logger }),
    embeddings: createGeminiEmbeddingsClient({ logger }),
    checkpointer: await getCheckpointer(),
    logger,
  }
}

export interface RunOptions {
  source: RequestSource
  flags?: AgentFlags | undefined
}

export type RunOutcome =
  | { status: 'awaiting_clarification'; clarification: ClarificationRequest }
  | { status: 'awaiting_approval'; approval: ApprovalRequest }
  | {
      status: 'answered'
      answer: string
      explanation: string
      sql: string
      tablesUsed: string[]
      assumptions: string[]
      columns: StoredColumn[]
      rows: unknown[][]
      rowCount: number
      truncated: boolean
    }
  | { status: 'cannot_answer'; reason: string }
  | { status: 'blocked'; stage: string; rule: string; message: string }
  | { status: 'cancelled' }
  | { status: 'failed'; errorCode: string; message: string }

/** Turns kept as conversation context (F12). */
export const CONTEXT_TURNS = 3
/** Questions still `running` this long after creation are marked failed at startup (12.6). */
export const STALE_RUN_MINUTES = 5

const TERMINAL = new Set<RunOutcome['status']>(['answered', 'cannot_answer', 'blocked', 'cancelled', 'failed'])

export async function createQuestion(input: {
  question: string
  conversationId?: string | undefined
}): Promise<{ questionId: string; conversationId: string }> {
  const db = getAppDb()
  let conversationId = input.conversationId
  if (conversationId === undefined) {
    const [created] = await db.insert(conversations).values({}).returning({ id: conversations.id })
    if (created === undefined) throw new Error('conversation not created')
    conversationId = created.id
  } else {
    const [found] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, conversationId))
    if (found === undefined) throw new AppError('NOT_FOUND', 'Conversation not found')
  }
  // Control characters are removed before storing (Postgres text cannot hold NUL);
  // input_guard still rejects empty and over-long questions.
  const [question] = await db
    .insert(questions)
    .values({ conversationId, question: stripControlCharacters(input.question) })
    .returning({ id: questions.id })
  if (question === undefined) throw new Error('question not created')
  return { questionId: question.id, conversationId }
}

/** The last answered turns of the conversation before this question, oldest first. */
async function conversationContext(conversationId: string, before: Date): Promise<ConversationTurn[]> {
  const rows = await getAppDb()
    .select({ question: questions.question, sql: questions.finalSql })
    .from(questions)
    .where(
      and(
        eq(questions.conversationId, conversationId),
        eq(questions.status, 'answered'),
        isNotNull(questions.finalSql),
        lt(questions.createdAt, before),
      ),
    )
    .orderBy(desc(questions.createdAt))
    .limit(CONTEXT_TURNS)
  return rows.flatMap((r) => (r.sql === null ? [] : [{ question: r.question, sql: r.sql }])).reverse()
}

// The checkpointed state is read back through this schema (only the fields that
// are persisted or returned), so nothing untyped leaves the graph.
const checkpointState = z.object({
  candidate: z
    .object({ sql: z.string(), tablesUsed: z.array(z.string()), assumptions: z.array(z.string()), explanation: z.string() })
    .nullable(),
  clarification: z.object({ question: z.string(), options: z.array(z.string()) }).nullable(),
  costEstimate: z.object({ cost: z.number(), softLimit: z.number(), needsApproval: z.boolean() }).nullable(),
  checkedSql: z.string().nullable(),
  attempts: z.number().int(),
  result: z
    .object({
      columns: z.array(z.object({ name: z.string(), type: z.string() })),
      rowCount: z.number().int(),
      truncated: z.boolean(),
    })
    .nullable(),
  answerText: z.string().nullable(),
  outcome: z
    .discriminatedUnion('status', [
      z.object({ status: z.literal('answered') }),
      z.object({ status: z.literal('cannot_answer'), reason: z.string() }),
      z.object({ status: z.literal('blocked'), stage: z.string(), rule: z.string(), message: z.string() }),
      z.object({ status: z.literal('cancelled') }),
      z.object({ status: z.literal('failed'), errorCode: z.string(), message: z.string() }),
    ])
    .nullable(),
  usage: z.object({ promptTokens: z.number().int(), completionTokens: z.number().int(), embeddingTokens: z.number().int() }),
  trace: z.array(
    z.object({
      node: z.string(),
      startedAt: z.string(),
      durationMs: z.number(),
      detail: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
})

type CheckpointState = z.infer<typeof checkpointState>

function outcomeOf(state: CheckpointState, next: readonly string[], rows: unknown[][] | undefined): RunOutcome {
  if (state.outcome === null) {
    if (next.includes('clarify') && state.clarification !== null) {
      return { status: 'awaiting_clarification', clarification: state.clarification }
    }
    if (next.includes('approval') && state.costEstimate !== null && state.checkedSql !== null) {
      return {
        status: 'awaiting_approval',
        approval: { estimatedCost: state.costEstimate.cost, softLimit: state.costEstimate.softLimit, sql: state.checkedSql },
      }
    }
    return { status: 'failed', errorCode: 'INTERNAL_ERROR', message: 'The run stopped without an outcome' }
  }
  const outcome = state.outcome
  if (outcome.status !== 'answered') return outcome
  if (state.candidate === null || state.result === null || state.answerText === null || rows === undefined) {
    return { status: 'failed', errorCode: 'INTERNAL_ERROR', message: 'The answer is incomplete' }
  }
  return {
    status: 'answered',
    answer: state.answerText,
    explanation: state.candidate.explanation,
    sql: state.candidate.sql,
    tablesUsed: state.candidate.tablesUsed,
    assumptions: state.candidate.assumptions,
    columns: state.result.columns,
    rows,
    rowCount: state.result.rowCount,
    truncated: state.result.truncated,
  }
}

async function persist(questionId: string, state: CheckpointState, outcome: RunOutcome, segmentMs: number): Promise<void> {
  const env = getEnv()
  const costMicroUsd = llmCostMicroUsd(state.usage.promptTokens, state.usage.completionTokens, {
    inputPer1MUsd: env.LLM_INPUT_PRICE_PER_1M_USD,
    outputPer1MUsd: env.LLM_OUTPUT_PRICE_PER_1M_USD,
  })
  const terminal = TERMINAL.has(outcome.status)
  const errorCode = outcome.status === 'failed' ? outcome.errorCode : outcome.status === 'blocked' ? outcome.rule : null
  await getAppDb()
    .update(questions)
    .set({
      status: outcome.status,
      finalSql: state.candidate?.sql ?? null,
      answer: outcome.status === 'answered' ? outcome.answer : null,
      explanation: state.candidate?.explanation ?? null,
      tablesUsed: state.candidate?.tablesUsed ?? null,
      assumptions: state.candidate?.assumptions ?? null,
      resultColumns: state.result?.columns ?? null,
      rowCount: state.result?.rowCount ?? null,
      truncated: state.result?.truncated ?? null,
      attempts: state.attempts,
      trace: state.trace,
      errorCode,
      promptTokens: state.usage.promptTokens,
      completionTokens: state.usage.completionTokens,
      embeddingTokens: state.usage.embeddingTokens,
      costUsd: microUsdToNumeric(costMicroUsd),
      latencyMs: sql`coalesce(${questions.latencyMs}, 0) + ${segmentMs}`,
      completedAt: terminal ? sql`now()` : null,
    })
    .where(eq(questions.id, questionId))
}

/** Runs the graph from `input` until it ends or pauses, then records the outcome. */
async function runSegment(
  questionId: string,
  input: Parameters<ReturnType<typeof buildAgentGraph>['invoke']>[0],
  deps: QuestionDeps,
): Promise<RunOutcome> {
  const rows = new Map<string, unknown[][]>()
  const graph = buildAgentGraph({ llm: deps.llm, embeddings: deps.embeddings, checkpointer: deps.checkpointer, rows })
  const config = { configurable: { thread_id: questionId } }
  const started = performance.now()
  let failure: { errorCode: string; message: string } | undefined
  try {
    await graph.invoke(input, config)
  } catch (err) {
    failure =
      err instanceof AppError
        ? { errorCode: err.code, message: err.message }
        : { errorCode: 'INTERNAL_ERROR', message: 'The question could not be processed' }
    deps.logger?.error({ err, questionId }, 'agent run failed')
  }
  const segmentMs = Math.round(performance.now() - started)
  const snapshot = await graph.getState(config)
  const state = checkpointState.parse(snapshot.values)
  const outcome: RunOutcome =
    failure === undefined ? outcomeOf(state, snapshot.next, rows.get(questionId)) : { status: 'failed', ...failure }
  await persist(questionId, state, outcome, segmentMs)
  return outcome
}

/** Starts a created question (status `running`). */
export async function runQuestion(questionId: string, options: RunOptions, deps: QuestionDeps): Promise<RunOutcome> {
  const [row] = await getAppDb()
    .select({
      question: questions.question,
      conversationId: questions.conversationId,
      createdAt: questions.createdAt,
      status: questions.status,
    })
    .from(questions)
    .where(eq(questions.id, questionId))
  if (row === undefined) throw new AppError('NOT_FOUND', 'Question not found')
  if (row.status !== 'running') throw new AppError('INVALID_STATE', 'The question has already run')
  const conversationContextTurns = await conversationContext(row.conversationId, row.createdAt)
  return runSegment(
    questionId,
    {
      questionId,
      question: row.question,
      source: options.source,
      flags: options.flags ?? FULL_FLAGS,
      conversationContext: conversationContextTurns,
    },
    deps,
  )
}

/** Moves a paused question back to `running`; 404 / 409 unless it waits in `from`. */
async function claimPaused(questionId: string, from: 'awaiting_clarification' | 'awaiting_approval'): Promise<void> {
  const db = getAppDb()
  const claimed = await db
    .update(questions)
    .set({ status: 'running' })
    .where(and(eq(questions.id, questionId), eq(questions.status, from)))
    .returning({ id: questions.id })
  if (claimed.length > 0) return
  const [exists] = await db.select({ id: questions.id }).from(questions).where(eq(questions.id, questionId))
  if (exists === undefined) throw new AppError('NOT_FOUND', 'Question not found')
  throw new AppError('INVALID_STATE', `The question is not ${from.replace('_', ' ')}`)
}

export async function resumeClarification(questionId: string, answer: string, deps: QuestionDeps): Promise<RunOutcome> {
  const parsed = z.string().trim().min(1).max(getEnv().QUESTION_MAX_LENGTH).safeParse(answer)
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'The clarification answer is empty or too long')
  await claimPaused(questionId, 'awaiting_clarification')
  return runSegment(questionId, new Command({ resume: parsed.data }), deps)
}

export async function resumeApproval(questionId: string, approved: boolean, deps: QuestionDeps): Promise<RunOutcome> {
  await claimPaused(questionId, 'awaiting_approval')
  return runSegment(questionId, new Command({ resume: { approved } }), deps)
}

/** At startup: questions still `running` after STALE_RUN_MINUTES lost their process (12.6). */
export async function recoverStaleRuns(): Promise<number> {
  const updated = await getAppDb()
    .update(questions)
    .set({ status: 'failed', errorCode: 'INTERRUPTED', completedAt: sql`now()` })
    .where(
      and(
        eq(questions.status, 'running'),
        lt(questions.createdAt, sql`now() - make_interval(mins => ${STALE_RUN_MINUTES})`),
      ),
    )
    .returning({ id: questions.id })
  return updated.length
}

