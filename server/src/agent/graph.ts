import { END, START, StateGraph, interrupt, type BaseCheckpointSaver } from '@langchain/langgraph'
import { z } from 'zod'
import { getEnv } from '../config/env.js'
import type { EmbeddingsClient } from '../retrieval/embeddings.js'
import { piiKindOf } from '../safety/mask.js'
import { retrieveContext } from '../services/retrieval.service.js'
import {
  checkCost,
  checkPolicy,
  executeChecked,
  recordApproval,
  type Blocked,
  type SoftLimitPolicy,
} from '../services/safe-query.service.js'
import type { LlmClient } from './llm.js'
import { generateOutput } from './output.js'
import { buildAnswerMessages } from './prompts/answer.js'
import { ZERO_ROW_REVIEW, buildGenerateMessages, zeroRowReviewWithRange } from './prompts/generate.js'
import { lookUpDataRange } from './date-range.js'
import { AgentState, type State, type Update } from './state.js'

// The agent graph (IMPLEMENTATION.md 12.1, 12.3). Every SQL goes through the safety
// stages (validate → cost → execute); a policy violation ends the run as `blocked`
// and is never sent back to the model. A fresh graph is built per run segment; the
// Postgres checkpointer carries the state across interrupts and restarts.

export interface AgentDeps {
  llm: LlmClient
  embeddings: EmbeddingsClient
  checkpointer: BaseCheckpointSaver
  /**
   * Masked result rows of this run segment, keyed by question id. Rows never enter
   * the checkpointed state (10.3: result rows are not persisted).
   */
  rows: Map<string, unknown[][]>
  /**
   * Optional observer for live progress (SSE `step` events, 14.3), called when a
   * node starts and when it completes. It only observes: it never changes state,
   * prompts, decisions or retries. The evaluation runner passes none.
   */
  onStep?: ((event: StepEvent) => void) | undefined
}

/** A node started or completed (SSE `step`, IMPLEMENTATION.md 14.3). */
export interface StepEvent {
  node: NodeName
  status: 'started' | 'completed'
  detail?: Record<string, unknown> | undefined
}

/** Payload of the `clarify` interrupt. */
export interface ClarificationRequest {
  question: string
  options: string[]
}

/** Payload of the `approval` interrupt. */
export interface ApprovalRequest {
  estimatedCost: number
  softLimit: number
  sql: string
}

export const NODES = [
  'input_guard',
  'retrieve_context',
  'generate',
  'clarify',
  'validate_sql',
  'cost_check',
  'approval',
  'execute',
  'mask_output',
  'answer',
] as const

export type NodeName = (typeof NODES)[number]

interface Step {
  update: Update
  detail?: Record<string, unknown>
}

/**
 * Records a trace entry when the node completes (interrupted nodes re-run on resume)
 * and reports start and completion to the optional observer.
 */
function tracedNode(
  node: NodeName,
  run: (state: State) => Promise<Step>,
  onStep: AgentDeps['onStep'],
): (state: State) => Promise<Update> {
  return async (state) => {
    const startedAt = new Date().toISOString()
    const started = performance.now()
    onStep?.({ node, status: 'started' })
    const step = await run(state)
    const entry = { node, startedAt, durationMs: Math.round(performance.now() - started) }
    onStep?.(step.detail === undefined ? { node, status: 'completed' } : { node, status: 'completed', detail: step.detail })
    return { ...step.update, trace: [step.detail === undefined ? entry : { ...entry, detail: step.detail }] }
  }
}

const SOFT_LIMIT_POLICY: Record<State['source'], SoftLimitPolicy> = {
  app: 'require_approval',
  mcp: 'block',
  eval: 'allow',
}

function maxAttempts(state: State): number {
  return state.flags.selfCorrection ? getEnv().MAX_SQL_ATTEMPTS : 1
}

/** Removes control characters except tab and newline (input_guard; not a security boundary). */
export function stripControlCharacters(text: string): string {
  return Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0
      const c0 = code < 0x20 && ch !== '\n' && ch !== '\t'
      return !c0 && !(code >= 0x7f && code <= 0x9f)
    })
    .join('')
}

/** A failure the model may fix: back to `generate` while attempts remain, else MAX_ATTEMPTS. */
function retryOrFail(state: State, sql: string, problem: string): Update {
  if (state.attempts < maxAttempts(state)) {
    return { lastError: { sql, problem } }
  }
  return {
    outcome: { status: 'failed', errorCode: 'MAX_ATTEMPTS', message: `No working SQL within ${maxAttempts(state)} attempt(s)` },
  }
}

function blockedOutcome(blocked: Blocked): Update {
  return { outcome: { status: 'blocked', stage: blocked.stage, rule: blocked.rule, message: blocked.message } }
}

function context(state: State): { source: State['source']; questionId: string } {
  return { source: state.source, questionId: state.questionId }
}

function requireValue<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`Agent state has no ${what}`)
  return value
}

export function buildAgentGraph(deps: AgentDeps) {
  const env = getEnv()
  const traced = (node: NodeName, run: (state: State) => Promise<Step>): ((state: State) => Promise<Update>) =>
    tracedNode(node, run, deps.onStep)

  const inputGuard = traced('input_guard', (state) => {
    const question = stripControlCharacters(state.question).trim()
    if (question === '' || question.length > env.QUESTION_MAX_LENGTH) {
      const message = question === '' ? 'The question is empty' : `The question is longer than ${env.QUESTION_MAX_LENGTH} characters`
      return Promise.resolve({ update: { question, outcome: { status: 'failed', errorCode: 'VALIDATION_ERROR', message } } })
    }
    return Promise.resolve({ update: { question } })
  })

  const retrieve = traced('retrieve_context', async (state) => {
    const retrieved = await retrieveContext(state.question, deps.embeddings, state.source, {
      schemaRetrieval: state.flags.schemaRetrieval,
      extras: state.flags.examplesGlossaryValues,
    })
    return {
      update: { retrieved },
      detail: {
        tables: retrieved.tables.length,
        // Names (schema-qualified, retrieval order) so failed runs can be diagnosed from the trace.
        tableNames: retrieved.tables.map((t) => `${t.schema}.${t.table}`),
        examples: retrieved.examples.length,
        glossary: retrieved.glossary.length,
        values: retrieved.values.length,
      },
    }
  })

  const generate = traced('generate', async (state) => {
    const clarifyAllowed = state.clarificationsUsed < env.MAX_CLARIFICATIONS
    const lastError = state.lastError
    const messages = buildGenerateMessages({
      question: state.question,
      context: requireValue(state.retrieved, 'retrieved context'),
      conversation: state.conversationContext,
      clarifications: state.clarificationAnswers,
      previous: lastError?.sql == null ? null : { sql: lastError.sql, problem: lastError.problem },
      feedback: lastError !== null && lastError.sql === null ? lastError.problem : null,
      clarifyAllowed,
      periodChoice: state.dataRange !== null && state.periodChoice !== null ? { range: state.dataRange, answer: state.periodChoice } : null,
    })
    const reply = await deps.llm.structured(messages, generateOutput(clarifyAllowed), { source: state.source, model: 'main' })
    const usage = { promptTokens: reply.inputTokens, completionTokens: reply.outputTokens, embeddingTokens: 0, llmRequests: 1 }
    if (!reply.ok) {
      // An unusable reply counts as an attempt (M3 plan default).
      const attempts = state.attempts + 1
      const update: Update =
        attempts < maxAttempts(state)
          ? { attempts, usage, lastError: { sql: null, problem: reply.issue } }
          : { attempts, usage, outcome: { status: 'failed', errorCode: 'MAX_ATTEMPTS', message: reply.issue } }
      return { update, detail: { action: 'invalid_output', attempt: attempts } }
    }
    const result = reply.value.result
    if (result.action === 'sql') {
      const attempts = state.attempts + 1
      return {
        update: { attempts, usage, candidate: result, lastError: null, clarification: null, checkedSql: null, costEstimate: null },
        detail: { action: 'sql', attempt: attempts },
      }
    }
    if (result.action === 'clarify') {
      // The user's answer replaces any pending review feedback (e.g. a zero-row
      // date-range review that asked which period to use).
      return {
        update: { usage, lastError: null, clarification: { question: result.question, options: result.options } },
        detail: { action: 'clarify' },
      }
    }
    return { update: { usage, outcome: { status: 'cannot_answer', reason: result.reason } }, detail: { action: 'cannot_answer' } }
  })

  const clarify = traced('clarify', (state) => {
    const request = requireValue(state.clarification, 'clarification request')
    const raw = interrupt<ClarificationRequest, unknown>(request)
    const answer = z.string().trim().min(1).max(env.QUESTION_MAX_LENGTH).parse(raw)
    return Promise.resolve({
      update: {
        clarification: null,
        clarificationsUsed: state.clarificationsUsed + 1,
        clarificationAnswers: [...state.clarificationAnswers, { question: request.question, answer }],
        // A clarification after the date-range lookup is the user's choice of period (12.3).
        ...(state.dataRange !== null ? { periodChoice: answer } : {}),
      },
    })
  })

  const validate = traced('validate_sql', async (state) => {
    const candidate = requireValue(state.candidate, 'SQL candidate')
    const result = await checkPolicy(candidate.sql, context(state))
    if (result.status === 'ok') {
      return { update: { checkedSql: result.sql }, detail: { rule: 'POLICY_OK' } }
    }
    // Only parse errors are retryable here; a policy violation ends the run (12.3).
    const update = result.retryable ? retryOrFail(state, candidate.sql, result.message) : blockedOutcome(result)
    return { update, detail: { rule: result.rule } }
  })

  const cost = traced('cost_check', async (state) => {
    const sql = requireValue(state.checkedSql, 'checked SQL')
    const result = await checkCost(sql, SOFT_LIMIT_POLICY[state.source], context(state))
    if (result.status === 'ok') {
      return { update: { costEstimate: { cost: result.cost, softLimit: env.QUERY_COST_SOFT_LIMIT, needsApproval: false } }, detail: { cost: result.cost } }
    }
    if (result.status === 'needs_approval') {
      return {
        update: { costEstimate: { cost: result.cost, softLimit: result.softLimit, needsApproval: true } },
        detail: { cost: result.cost, rule: 'COST_SOFT_LIMIT' },
      }
    }
    const candidateSql = requireValue(state.candidate, 'SQL candidate').sql
    const update = result.retryable
      ? retryOrFail(state, candidateSql, result.dbError?.message ?? result.message)
      : blockedOutcome(result)
    return { update, detail: { rule: result.rule } }
  })

  const approval = traced('approval', async (state) => {
    const estimate = requireValue(state.costEstimate, 'cost estimate')
    const sql = requireValue(state.checkedSql, 'checked SQL')
    const raw = interrupt<ApprovalRequest, unknown>({ estimatedCost: estimate.cost, softLimit: estimate.softLimit, sql })
    const { approved } = z.object({ approved: z.boolean() }).parse(raw)
    await recordApproval(sql, approved, estimate.cost, context(state))
    return {
      update: approved ? { approvalDecision: { approved } } : { approvalDecision: { approved }, outcome: { status: 'cancelled' } },
      detail: { approved },
    }
  })

  const execute = traced('execute', async (state) => {
    const sql = requireValue(state.checkedSql, 'checked SQL')
    const candidateSql = requireValue(state.candidate, 'SQL candidate').sql
    const result = await executeChecked(sql, context(state))
    if (result.status === 'blocked') {
      const update = result.retryable
        ? retryOrFail(state, candidateSql, result.dbError?.message ?? result.message)
        : blockedOutcome(result)
      return { update, detail: { rule: result.rule } }
    }
    deps.rows.set(state.questionId, result.rows)
    const meta = {
      columns: result.columns.map((c) => ({ name: c.name, type: c.type })),
      maskedColumns: result.columns.filter((c) => piiKindOf(c.origin) !== undefined).map((c) => c.name),
      rowCount: result.rowCount,
      truncated: result.truncated,
    }
    const detail = { rowCount: result.rowCount, truncated: result.truncated }
    const review =
      result.rowCount === 0 && state.flags.selfCorrection && !state.zeroRowReviewDone && state.attempts < maxAttempts(state)
    if (review) {
      // Zero rows: back to generate once with a re-check instruction (12.3). When the
      // SQL filters on a date column, its actual range goes with the instruction.
      const retrieved = requireValue(state.retrieved, 'retrieved context')
      const dataRange = await lookUpDataRange(candidateSql, retrieved.tables, context(state))
      const clarifyAllowed = state.clarificationsUsed < env.MAX_CLARIFICATIONS
      const problem = dataRange === null ? ZERO_ROW_REVIEW : zeroRowReviewWithRange(dataRange, clarifyAllowed)
      return {
        update: { result: meta, zeroRowReviewDone: true, dataRange, lastError: { sql: candidateSql, problem } },
        detail: dataRange === null ? detail : { ...detail, dataRange },
      }
    }
    return { update: { result: meta }, detail }
  })

  const mask = traced('mask_output', (state) => {
    // Rows were masked by the safety executor stage (layer 5); this step records which columns.
    const meta = requireValue(state.result, 'result')
    return Promise.resolve({ update: {}, detail: { maskedColumns: meta.maskedColumns } })
  })

  const answer = traced('answer', async (state) => {
    const meta = requireValue(state.result, 'result')
    const rows = deps.rows.get(state.questionId)
    if (rows === undefined) throw new Error('Result rows are not available for the answer step')
    const candidate = requireValue(state.candidate, 'SQL candidate')
    const reply = await deps.llm.chat(
      buildAnswerMessages({
        question: state.question,
        sql: candidate.sql,
        columns: meta.columns.map((c) => c.name),
        rows,
        rowCount: meta.rowCount,
        truncated: meta.truncated,
        dataRange: state.dataRange,
        assumptions: candidate.assumptions,
        periodChoice: state.periodChoice,
      }),
      { source: state.source, model: 'answer' },
    )
    return {
      update: {
        answerText: reply.text.trim(),
        outcome: { status: 'answered' },
        usage: { promptTokens: reply.inputTokens, completionTokens: reply.outputTokens, embeddingTokens: 0, llmRequests: 1 },
      },
    }
  })

  const ended = (state: State): boolean => state.outcome !== null

  return new StateGraph(AgentState)
    .addNode('input_guard', inputGuard)
    .addNode('retrieve_context', retrieve)
    .addNode('generate', generate)
    .addNode('clarify', clarify)
    .addNode('validate_sql', validate)
    .addNode('cost_check', cost)
    .addNode('approval', approval)
    .addNode('execute', execute)
    .addNode('mask_output', mask)
    .addNode('answer', answer)
    .addEdge(START, 'input_guard')
    .addConditionalEdges('input_guard', (s) => (ended(s) ? END : 'retrieve_context'), ['retrieve_context', END])
    .addEdge('retrieve_context', 'generate')
    .addConditionalEdges(
      'generate',
      (s) => (ended(s) ? END : s.clarification !== null ? 'clarify' : s.lastError !== null ? 'generate' : 'validate_sql'),
      ['clarify', 'generate', 'validate_sql', END],
    )
    .addEdge('clarify', 'generate')
    .addConditionalEdges(
      'validate_sql',
      (s) => (ended(s) ? END : s.lastError !== null ? 'generate' : 'cost_check'),
      ['generate', 'cost_check', END],
    )
    .addConditionalEdges(
      'cost_check',
      (s) => (ended(s) ? END : s.lastError !== null ? 'generate' : s.costEstimate?.needsApproval === true ? 'approval' : 'execute'),
      ['generate', 'approval', 'execute', END],
    )
    .addConditionalEdges('approval', (s) => (ended(s) ? END : 'execute'), ['execute', END])
    .addConditionalEdges(
      'execute',
      (s) => (ended(s) ? END : s.lastError !== null ? 'generate' : 'mask_output'),
      ['generate', 'mask_output', END],
    )
    .addEdge('mask_output', 'answer')
    .addEdge('answer', END)
    .compile({ checkpointer: deps.checkpointer })
}

export type AgentGraph = ReturnType<typeof buildAgentGraph>
